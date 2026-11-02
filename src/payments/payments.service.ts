import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import {
  errorMessage,
  isEmptyGuid,
  pbmsPick,
  pbmsPickDate,
  pbmsPickGuid,
  pbmsPickNumber,
  sameStatus,
  toMoney,
} from '../common/pbms-fields';
import { isMotorbikeType } from '../common/license-plate';
import { WalletsService } from '../wallets/wallets.service';
import { PayosService } from '../integrations/payos-files.service';
import { issueExitPass } from '../common/exit-pass';
import type { PaymentResultState, PaymentResultView } from './payment-result.page';

export const PAYMENT_TYPE_LABELS: Record<string, string> = {
  Deposit: 'Tiền cọc đặt chỗ',
  SubscriptionFee: 'Vé tháng',
  SubscriptionRenewal: 'Gia hạn vé tháng',
  CheckoutFee: 'Phí gửi xe',
  WalletTopUp: 'Nạp ví PBMS',
  PrepaidCheckout: 'Thanh toán trước khi ra bãi',
};
import { NotificationsService, formatTime, formatVnd } from '../notifications/notifications.service';
import { entryWindow } from '../reservations/reservation-rules';
import {
  SubscriptionActivationError,
  activateSubscriptionInTx,
  extendSubscriptionInTx,
} from '../subscriptions/activate-subscription';

const METHODS = ['PayOS', 'Cash', 'Wallet'];
const STATUSES = ['Pending', 'Success', 'Failed', 'Refunded'];
const TYPES = [
  'Deposit',
  'CheckoutFee',
  'SubscriptionFee',
  'SubscriptionRenewal',
  'WalletTopUp',
  'PrepaidCheckout',
];
const MY_PAGE_SIZE_DEFAULT = 20;
const MY_PAGE_SIZE_MAX = 50;
/** Đối soát: chỉ hỏi lại thanh toán chờ đã quá 5 phút (webhook thường về trước) và chưa quá 3 ngày. */
const RECONCILE_AFTER_MS = 5 * 60 * 1000;
const RECONCILE_WITHIN_MS = 3 * 864e5;
const RECONCILE_BATCH = 50;

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private reconciling = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallets: WalletsService,
    private readonly payos: PayosService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  mapPayment(payment: {
    id: string;
    userId: string | null;
    sessionId: string | null;
    reservationId: string | null;
    subscriptionId: string | null;
    amount: Prisma.Decimal;
    paymentMethod: string;
    paymentType: string | null;
    paymentTime: Date;
    paymentStatus: string;
    transactionReference: string | null;
  }) {
    return {
      paymentId: payment.id,
      userId: payment.userId,
      sessionId: payment.sessionId,
      reservationId: payment.reservationId,
      subscriptionId: payment.subscriptionId,
      amount: toMoney(payment.amount),
      paymentMethod: payment.paymentMethod,
      paymentType: payment.paymentType,
      paymentTime: payment.paymentTime,
      paymentStatus: payment.paymentStatus,
      transactionReference: payment.transactionReference,
    };
  }

  async getAll(): Promise<PbmsResponseDto> {
    const payments = await this.prisma.payment.findMany({ orderBy: { paymentTime: 'desc' } });
    return PbmsResponseDto.ok('Lấy danh sách thanh toán thành công', payments.map((p) => this.mapPayment(p)));
  }

  /**
   * Lịch sử thanh toán của chính khách (mọi phương thức: PayOS, ví, tiền mặt), mới nhất trước.
   * [status] lọc theo Pending/Success/Failed; trang bắt đầu từ 1.
   */
  async getMine(
    userId: string,
    pageRaw?: string,
    pageSizeRaw?: string,
    statusRaw?: string,
  ): Promise<PbmsResponseDto> {
    if (isEmptyGuid(userId)) {
      return PbmsResponseDto.fail('Vui lòng đăng nhập', 401);
    }
    const page = Math.max(1, Number.parseInt(pageRaw ?? '', 10) || 1);
    const pageSize = Math.min(
      MY_PAGE_SIZE_MAX,
      Math.max(1, Number.parseInt(pageSizeRaw ?? '', 10) || MY_PAGE_SIZE_DEFAULT),
    );
    const status = STATUSES.find((s) => sameStatus(s, statusRaw?.trim() ?? ''));
    if (statusRaw?.trim() && !status) {
      return PbmsResponseDto.fail(`Trạng thái lọc phải là một trong: ${STATUSES.join(', ')}`);
    }
    const where: Prisma.PaymentWhereInput = { userId, ...(status ? { paymentStatus: status } : {}) };
    const [total, items] = await Promise.all([
      this.prisma.payment.count({ where }),
      this.prisma.payment.findMany({
        where,
        include: {
          session: { select: { licensePlateIn: true } },
          reservation: { select: { vehicle: { select: { licensePlate: true } } } },
          subscription: {
            select: {
              vehicle: { select: { licensePlate: true } },
              package: { select: { packageName: true } },
            },
          },
        },
        orderBy: [{ paymentTime: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return PbmsResponseDto.ok('Lấy lịch sử thanh toán thành công', {
      items: items.map((p) => ({
        ...this.mapPayment(p),
        paymentTypeLabel: PAYMENT_TYPE_LABELS[p.paymentType ?? ''] ?? p.paymentType,
        licensePlate:
          p.subscription?.vehicle?.licensePlate ??
          p.reservation?.vehicle?.licensePlate ??
          p.session?.licensePlateIn ??
          null,
        packageName: p.subscription?.package?.packageName ?? null,
      })),
      page,
      pageSize,
      total,
      hasMore: page * pageSize < total,
    });
  }

  async getById(id: string): Promise<PbmsResponseDto> {
    if (isEmptyGuid(id)) {
      return PbmsResponseDto.fail('Vui lòng nhập PaymentId');
    }
    const payment = await this.prisma.payment.findUnique({ where: { id } });
    if (!payment) {
      return PbmsResponseDto.fail('Không tìm thấy thanh toán', 404);
    }
    return PbmsResponseDto.ok('Lấy thông tin thanh toán thành công', this.mapPayment(payment));
  }

  async create(dto: object): Promise<PbmsResponseDto> {
    const amount = pbmsPickNumber(dto, 'amount', 'Amount');
    const validation = await this.validatePayment(
      pbmsPickGuid(dto, 'userId', 'UserId') || null,
      pbmsPickGuid(dto, 'sessionId', 'SessionId') || null,
      pbmsPickGuid(dto, 'reservationId', 'ReservationId') || null,
      pbmsPickGuid(dto, 'subscriptionId', 'SubscriptionId') || null,
      amount,
      pbmsPick(dto, 'paymentMethod', 'PaymentMethod'),
      pbmsPick(dto, 'paymentStatus', 'PaymentStatus') || 'Success',
      pbmsPick(dto, 'paymentType', 'PaymentType') || 'CheckoutFee',
    );
    if (validation.error) {
      return validation.error;
    }
    const payment = await this.prisma.payment.create({
      data: {
        userId: validation.userId,
        sessionId: validation.sessionId,
        reservationId: validation.reservationId,
        subscriptionId: validation.subscriptionId,
        amount: new Prisma.Decimal(amount ?? 0),
        paymentMethod: validation.method,
        paymentType: validation.type,
        paymentTime: pbmsPickDate(dto, 'paymentTime', 'PaymentTime') ?? new Date(),
        paymentStatus: validation.status,
        transactionReference: pbmsPick(dto, 'transactionReference', 'TransactionReference').trim() || null,
      },
    });
    if (sameStatus(payment.paymentStatus, 'Success')) {
      await this.dispatchPayment(payment.id);
    }
    return PbmsResponseDto.ok('Tạo thanh toán thành công', this.mapPayment(payment), 201);
  }

  async update(dto: object): Promise<PbmsResponseDto> {
    const id = pbmsPickGuid(dto, 'paymentId', 'PaymentId');
    if (isEmptyGuid(id)) {
      return PbmsResponseDto.fail('Dữ liệu cập nhật thanh toán không hợp lệ');
    }
    const existing = await this.prisma.payment.findUnique({ where: { id } });
    if (!existing) {
      return PbmsResponseDto.fail('Không tìm thấy thanh toán', 404);
    }
    const wasSuccessful = sameStatus(existing.paymentStatus, 'Success');
    const amount = pbmsPickNumber(dto, 'amount', 'Amount') ?? Number(existing.amount);
    const validation = await this.validatePayment(
      pbmsPickGuid(dto, 'userId', 'UserId') || existing.userId,
      pbmsPickGuid(dto, 'sessionId', 'SessionId') || existing.sessionId,
      pbmsPickGuid(dto, 'reservationId', 'ReservationId') || existing.reservationId,
      pbmsPickGuid(dto, 'subscriptionId', 'SubscriptionId') || existing.subscriptionId,
      amount,
      pbmsPick(dto, 'paymentMethod', 'PaymentMethod') || existing.paymentMethod,
      pbmsPick(dto, 'paymentStatus', 'PaymentStatus') || existing.paymentStatus,
      pbmsPick(dto, 'paymentType', 'PaymentType') || existing.paymentType || 'CheckoutFee',
    );
    if (validation.error) {
      return validation.error;
    }
    const payment = await this.prisma.payment.update({
      where: { id },
      data: {
        userId: validation.userId,
        sessionId: validation.sessionId,
        reservationId: validation.reservationId,
        subscriptionId: validation.subscriptionId,
        amount: new Prisma.Decimal(amount),
        paymentMethod: validation.method,
        paymentType: validation.type,
        paymentTime: pbmsPickDate(dto, 'paymentTime', 'PaymentTime') ?? existing.paymentTime,
        paymentStatus: validation.status,
        transactionReference:
          pbmsPick(dto, 'transactionReference', 'TransactionReference').trim() || existing.transactionReference,
      },
    });
    if (!wasSuccessful && sameStatus(payment.paymentStatus, 'Success')) {
      await this.dispatchPayment(payment.id);
    }
    return PbmsResponseDto.ok('Cập nhật thanh toán thành công', this.mapPayment(payment));
  }

  async remove(id: string): Promise<PbmsResponseDto> {
    if (isEmptyGuid(id)) {
      return PbmsResponseDto.fail('Vui lòng nhập PaymentId');
    }
    const existing = await this.prisma.payment.findUnique({ where: { id } });
    if (!existing) {
      return PbmsResponseDto.fail('Không tìm thấy thanh toán', 404);
    }
    try {
      await this.prisma.payment.delete({ where: { id } });
      return PbmsResponseDto.ok('Xóa thanh toán thành công');
    } catch (error: unknown) {
      return PbmsResponseDto.fail(`Lỗi xóa thanh toán: ${errorMessage(error)}`, 500);
    }
  }

  async handleWebhook(body: Record<string, unknown>): Promise<void> {
    const data = (body.data ?? body.Data) as Record<string, unknown> | undefined;
    if (!data) {
      return;
    }
    const orderCode = String(data.orderCode ?? data.OrderCode ?? '').trim();
    if (!orderCode) {
      return;
    }
    const payment = await this.prisma.payment.findFirst({
      where: { transactionReference: orderCode },
    });
    if (!payment || !sameStatus(payment.paymentStatus, 'Pending')) {
      return;
    }
    // Webhook không kiểm tra chữ ký và khách biết orderCode của mình: với mọi loại thanh toán
    // chỉ tin trạng thái tra trực tiếp từ PayOS, không tin body gửi tới.
    await this.syncPayosPayment(payment.id);
  }

  /**
   * Đồng bộ một thanh toán PayOS đang chờ bằng cách tra cứu trực tiếp PayOS.
   * Dùng cho webhook (loại nhạy cảm) và nút "Tôi đã thanh toán" trên app.
   */
  async syncPayosPayment(paymentId: string): Promise<string> {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) {
      return 'Failed';
    }
    if (
      !sameStatus(payment.paymentStatus, 'Pending') ||
      !sameStatus(payment.paymentMethod, 'PayOS') ||
      !payment.transactionReference
    ) {
      return payment.paymentStatus;
    }
    const remote = await this.payos.getPaymentStatus(payment.transactionReference);
    const paid = remote.status === 'PAID' && remote.amountPaid >= Number(payment.amount);
    const closed = remote.status === 'CANCELLED' || remote.status === 'EXPIRED';
    if (!paid && !closed) {
      return 'Pending';
    }
    // Chuyển trạng thái có điều kiện: webhook và nút kiểm tra chạy song song chỉ xử lý một lần.
    const moved = await this.prisma.payment.updateMany({
      where: { id: payment.id, paymentStatus: 'Pending' },
      data: { paymentStatus: paid ? 'Success' : 'Failed', paymentTime: new Date() },
    });
    if (moved.count === 1 && paid) {
      await this.dispatchPayment(payment.id);
    } else if (moved.count === 1 && sameStatus(payment.paymentType ?? '', 'CheckoutFee')) {
      // Khách huỷ link phí ra bãi: mở lại lượt gửi để làm checkout lại.
      await this.restoreCheckoutSession(payment.sessionId);
    }
    return paid ? 'Success' : 'Failed';
  }

  /**
   * Mỗi 5 phút: hỏi lại PayOS các thanh toán đang chờ, phòng webhook không tới (Render ngủ, mạng lỗi):
   * khách đã trả mà ví/vé/đặt chỗ vẫn chưa cập nhật. Mới nhất trước; một lượt chạy không chồng lượt trước.
   */
  @Cron('*/5 * * * *')
  async reconcilePendingPayos(): Promise<void> {
    if (this.reconciling) return;
    this.reconciling = true;
    try {
      const now = Date.now();
      const pending = await this.prisma.payment.findMany({
        where: {
          paymentStatus: 'Pending',
          paymentMethod: 'PayOS',
          transactionReference: { not: '' },
          paymentTime: { lt: new Date(now - RECONCILE_AFTER_MS), gt: new Date(now - RECONCILE_WITHIN_MS) },
        },
        select: { id: true },
        orderBy: { paymentTime: 'desc' },
        take: RECONCILE_BATCH,
      });
      for (const payment of pending) {
        try {
          await this.syncPayosPayment(payment.id);
        } catch (error: unknown) {
          this.logger.warn(`Đối soát PayOS ${payment.id} lỗi: ${errorMessage(error)}`);
        }
      }
    } finally {
      this.reconciling = false;
    }
  }

  /**
   * Kết quả cho trang PayOS chuyển về. Hỏi lại PayOS (syncPayosPayment) nên trạng thái
   * cập nhật ngay cả khi webhook chưa tới; huỷ trên PayOS sẽ chuyển thanh toán sang Failed.
   * Chỉ trả loại và số tiền, không lộ thông tin cá nhân.
   */
  async resultForOrderCode(orderCode: string | undefined, cancelled: boolean): Promise<PaymentResultView> {
    const code = (orderCode ?? '').trim();
    if (!/^\d{1,20}$/.test(code)) {
      return { state: 'unknown', orderCode: '', amount: null, typeLabel: null };
    }
    const payment = await this.prisma.payment.findFirst({
      where: { transactionReference: code, paymentMethod: 'PayOS' },
    });
    if (!payment) {
      return { state: 'unknown', orderCode: code, amount: null, typeLabel: null };
    }
    let status = payment.paymentStatus;
    try {
      status = await this.syncPayosPayment(payment.id);
    } catch {
      // PayOS không phản hồi: hiện trạng thái đang có, app sẽ kiểm tra lại sau.
    }
    const state: PaymentResultState = sameStatus(status, 'Success')
      ? 'success'
      : sameStatus(status, 'Failed')
        ? cancelled ? 'cancelled' : 'failed'
        : cancelled ? 'cancelled' : 'pending';
    return {
      state,
      orderCode: code,
      amount: toMoney(payment.amount),
      typeLabel: PAYMENT_TYPE_LABELS[payment.paymentType ?? ''] ?? 'Thanh toán PBMS',
    };
  }

  /** Khách tự kiểm tra một thanh toán PayOS của mình (nạp ví, thanh toán trước, gói tháng). */
  async syncMine(paymentId: string, userId: string): Promise<PbmsResponseDto> {
    if (isEmptyGuid(paymentId)) {
      return PbmsResponseDto.fail('PaymentId không hợp lệ');
    }
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment || payment.userId !== userId) {
      return PbmsResponseDto.fail('Không tìm thấy thanh toán', 404);
    }
    try {
      const status = await this.syncPayosPayment(payment.id);
      return PbmsResponseDto.ok('Lấy trạng thái thanh toán thành công', {
        paymentId: payment.id,
        paymentType: payment.paymentType,
        paymentStatus: status,
        ...(sameStatus(payment.paymentType ?? '', 'WalletTopUp')
          ? await this.wallets.getBalanceForUser(userId)
          : {}),
      });
    } catch (error: unknown) {
      return PbmsResponseDto.fail(`Không kiểm tra được thanh toán: ${errorMessage(error)}`, 502);
    }
  }

  /** Áp dụng một thanh toán đã thành công rồi báo cho khách. */
  async dispatchPayment(paymentId: string): Promise<void> {
    await this.applyPaidPayment(paymentId);
    await this.notifyPaid(paymentId);
  }

  private async notifyPaid(paymentId: string): Promise<void> {
    if (!this.notifications) return;
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        session: { select: { licensePlateIn: true } },
        // Tiền tặng của mã khuyến mãi nạp ví (nếu có).
        walletTransactions: { where: { bucket: 'BONUS', amount: { gt: 0 } }, select: { amount: true } },
      },
    });
    if (!payment || !sameStatus(payment.paymentStatus, 'Success')) return;
    const amount = formatVnd(toMoney(payment.amount));
    const bonus = payment.walletTransactions?.[0]?.amount;
    const type = payment.paymentType ?? '';
    const note = sameStatus(type, 'Deposit')
      ? { title: 'Đặt chỗ đã được xác nhận', message: `Đã nhận tiền cọc ${amount}. Chỗ ô tô của bạn được giữ tới giờ hẹn.`, type: 'reservation' as const }
      : sameStatus(type, 'SubscriptionFee')
        ? { title: 'Vé tháng đã kích hoạt', message: `Đã thanh toán ${amount}. Vé tháng của bạn đã được kích hoạt.`, type: 'subscription' as const }
        : sameStatus(type, 'SubscriptionRenewal')
          ? { title: 'Đã gia hạn vé tháng', message: `Đã thanh toán ${amount} để gia hạn vé tháng.`, type: 'subscription' as const }
          : sameStatus(type, 'WalletTopUp')
            ? {
                title: 'Nạp ví thành công',
                message: `Đã cộng ${amount} vào ví PBMS.${bonus ? ` Tặng thêm ${formatVnd(toMoney(bonus))} khuyến mãi.` : ''}`,
                type: 'wallet' as const,
              }
            : sameStatus(type, 'PrepaidCheckout')
              ? { title: 'Đã thanh toán trước', message: `Đã nhận ${amount}. Mã ra cổng đã sẵn sàng, dùng được tới khi xe rời bãi.`, type: 'payment' as const }
              : sameStatus(type, 'CheckoutFee')
                ? { title: 'Đã thanh toán phí gửi xe', message: `Đã nhận ${amount}. Cảm ơn bạn đã gửi xe tại PBMS.`, type: 'payment' as const }
                : null;
    if (!note) return;
    const metadata = { paymentId: payment.id, paymentType: type };
    if (payment.userId) {
      await this.notifications.notify(payment.userId, { ...note, metadata });
    } else {
      // Thanh toán tại cổng của xe đã đăng ký nhưng không gắn tài khoản: báo cho chủ xe.
      await this.notifications.notifyPlateOwner(payment.session?.licensePlateIn, { ...note, metadata });
    }
  }

  private async applyPaidPayment(paymentId: string): Promise<void> {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment || !sameStatus(payment.paymentStatus, 'Success')) {
      return;
    }
    const type = payment.paymentType ?? '';
    if (sameStatus(type, 'Deposit')) {
      if (!payment.reservationId) {
        throw new Error(`Không thể xác nhận đặt chỗ cho thanh toán ${payment.id}: thiếu ReservationId.`);
      }
      const reservation = await this.prisma.reservation.findUnique({ where: { id: payment.reservationId } });
      if (!reservation) {
        throw new Error(
          `Thanh toán ${payment.id} thành công nhưng không tìm thấy đặt chỗ ${payment.reservationId}.`,
        );
      }
      // Cọc về khi đơn còn chờ và chưa quá khung vào bãi: giữ chỗ. Quá giờ thì xác nhận cũng vô ích
      // (cron sẽ chuyển NoShow ngay), nên hoàn cọc vào ví.
      const stillUsable =
        sameStatus(reservation.status, 'Pending') &&
        new Date() <= entryWindow(reservation.expectedEntryTime).until;
      if (stillUsable) {
        const confirmed = await this.prisma.reservation.updateMany({
          where: { id: reservation.id, status: 'Pending' },
          data: { status: 'Confirmed' },
        });
        if (confirmed.count === 1) return;
      }
      const latest = await this.prisma.reservation.findUnique({
        where: { id: reservation.id },
        select: { status: true },
      });
      if (latest && ['Pending', 'Cancelled', 'NoShow'].some((s) => sameStatus(latest.status, s))) {
        if (sameStatus(latest.status, 'Pending')) {
          await this.prisma.reservation.updateMany({
            where: { id: reservation.id, status: 'Pending' },
            data: { status: 'Cancelled' },
          });
        }
        // Cọc về sau khi đơn đã huỷ / quá giờ: không mở lại đơn, hoàn tiền vào ví.
        await this.refundLateDeposit(payment, reservation.vehicleId);
      }
      return;
    }
    if (sameStatus(type, 'SubscriptionFee')) {
      if (!payment.subscriptionId) {
        throw new Error(`Không thể kích hoạt gói tháng cho thanh toán ${payment.id}: thiếu SubscriptionId.`);
      }
      await this.activateSubscription(payment, payment.subscriptionId);
      return;
    }
    if (sameStatus(type, 'SubscriptionRenewal')) {
      if (!payment.subscriptionId) {
        throw new Error(`Không thể gia hạn gói tháng cho thanh toán ${payment.id}: thiếu SubscriptionId.`);
      }
      await this.completeRenewal(payment);
      return;
    }
    if (sameStatus(type, 'CheckoutFee')) {
      await this.completeCheckoutSession(payment);
      return;
    }
    if (sameStatus(type, 'WalletTopUp')) {
      if (!payment.userId) {
        throw new Error(`Không thể cộng ví cho thanh toán ${payment.id}: thiếu UserId.`);
      }
      await this.prisma.$transaction(async (tx) => {
        await this.wallets.creditFromPayment(tx, payment);
      });
      return;
    }
    if (sameStatus(type, 'PrepaidCheckout')) {
      if (!payment.sessionId) {
        throw new Error(`Thanh toán trước ${payment.id} thiếu SessionId.`);
      }
      await issueExitPass(this.prisma, payment.sessionId);
      return;
    }
    throw new Error(`Không có luồng xử lý cho loại thanh toán '${payment.paymentType}'.`);
  }

  /** Tiền cọc về sau khi đặt chỗ đã huỷ/hết hiệu lực: cộng vào ví (ngăn tiền thật) và báo khách. */
  private async refundLateDeposit(
    payment: { id: string; userId: string | null; amount: Prisma.Decimal },
    vehicleId: string,
  ): Promise<void> {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { licensePlate: true } });
    const plate = vehicle?.licensePlate ?? '';
    await this.refundToWallet(
      payment,
      'Deposit',
      `Hoàn cọc đặt chỗ xe ${plate}`,
      'Đã hoàn tiền cọc',
      `Đặt chỗ xe ${plate} đã huỷ trước khi tiền cọc về.`,
    );
  }

  /** Tiền PayOS đã về nhưng không áp dụng được: cộng lại vào ví (ngăn tiền thật), đánh dấu Refunded, báo khách. */
  private async refundToWallet(
    payment: { id: string; userId: string | null; amount: Prisma.Decimal },
    referenceType: string,
    description: string,
    title: string,
    reason: string,
  ): Promise<void> {
    if (!payment.userId) return;
    const credited = await this.prisma.$transaction(async (tx) => {
      const done = await this.wallets.creditRefund(tx, payment, referenceType, description);
      await tx.payment.update({ where: { id: payment.id }, data: { paymentStatus: 'Refunded' } });
      return done;
    });
    if (credited) {
      await this.notifications?.notify(payment.userId, {
        title,
        message: `${reason} Đã hoàn ${formatVnd(toMoney(payment.amount))} vào ví PBMS.`,
        type: 'wallet',
        metadata: { paymentId: payment.id },
      });
    }
  }

  /** Kích hoạt vé vừa trả qua PayOS. Không kích hoạt được (ô đã có người nhận, hết ô, vé đã huỷ) thì huỷ đơn và hoàn tiền vào ví. */
  private async activateSubscription(
    payment: { id: string; userId: string | null; amount: Prisma.Decimal },
    subscriptionId: string,
  ): Promise<void> {
    try {
      await this.prisma.$transaction((tx) => activateSubscriptionInTx(tx, subscriptionId));
    } catch (error: unknown) {
      if (!(error instanceof SubscriptionActivationError)) throw error;
      await this.prisma.monthlySubscription.updateMany({
        where: { id: subscriptionId, status: 'PendingPayment' },
        data: { status: 'Cancelled' },
      });
      await this.refundToWallet(
        payment,
        'SubscriptionFee',
        'Hoàn tiền vé tháng không kích hoạt được',
        'Đã hoàn tiền vé tháng',
        `Không kích hoạt được vé tháng: ${error.message}`,
      );
    }
  }

  /** Gia hạn vừa trả qua PayOS: cộng thời hạn của gói khách đã chọn. Vé không còn gia hạn được thì hoàn tiền vào ví. */
  private async completeRenewal(payment: {
    id: string;
    userId: string | null;
    subscriptionId: string | null;
    packageId: string | null;
    amount: Prisma.Decimal;
  }): Promise<void> {
    if (!payment.subscriptionId) {
      return;
    }
    const subscription = await this.prisma.monthlySubscription.findUnique({
      where: { id: payment.subscriptionId },
      select: { id: true, packageId: true },
    });
    if (!subscription) {
      throw new Error(
        `Thanh toán thành công nhưng không tìm thấy gói tháng ${payment.subscriptionId} để gia hạn.`,
      );
    }
    // Thanh toán gia hạn cũ (trước khi lưu gói) không có packageId: dùng gói hiện tại của vé như trước.
    const pkg = await this.prisma.subscriptionPackage.findUnique({
      where: { id: payment.packageId ?? subscription.packageId },
      select: { durationDays: true },
    });
    if (!pkg) {
      throw new Error(`Không tìm thấy gói gia hạn của thanh toán ${payment.id}.`);
    }
    const subscriptionId = subscription.id;
    try {
      await this.prisma.$transaction((tx) =>
        extendSubscriptionInTx(tx, subscriptionId, pkg.durationDays, payment.amount),
      );
    } catch (error: unknown) {
      if (!(error instanceof SubscriptionActivationError)) throw error;
      await this.refundToWallet(
        payment,
        'SubscriptionRenewal',
        'Hoàn tiền gia hạn vé tháng',
        'Đã hoàn tiền gia hạn',
        `Không gia hạn được vé tháng: ${error.message}`,
      );
    }
  }

  private async completeCheckoutSession(payment: {
    sessionId: string | null;
  }): Promise<void> {
    if (!payment.sessionId) {
      return;
    }
    const session = await this.prisma.parkingSession.findUnique({ where: { id: payment.sessionId } });
    if (!session || !session.exitTime || !session.exitGateId) {
      return;
    }
    await this.prisma.parkingSession.update({
      where: { id: session.id },
      data: { status: 'Completed' },
    });
    if (session.actualSlotId) {
      const slot = await this.prisma.parkingSlot.findUnique({ where: { id: session.actualSlotId } });
      if (slot && sameStatus(slot.status, 'Occupied')) {
        await this.prisma.parkingSlot.update({
          where: { id: slot.id },
          data: { status: slot.assignedUserId ? 'Assigned' : 'Available' },
        });
      }
    }
    if (session.reservationId) {
      await this.prisma.reservation.update({
        where: { id: session.reservationId },
        data: { status: 'Completed' },
      });
    }
  }

  private async restoreCheckoutSession(sessionId: string | null): Promise<void> {
    if (!sessionId) {
      return;
    }
    const session = await this.prisma.parkingSession.findUnique({ where: { id: sessionId } });
    if (!session || !sameStatus(session.status, 'Active')) {
      return;
    }
    await this.prisma.parkingSession.update({
      where: { id: sessionId },
      data: {
        exitGateId: null,
        exitTime: null,
        licensePlateOut: null,
        exitImageUrl: null,
        driverExitImageUrl: null,
      },
    });
  }

  private async validatePayment(
    userId: string | null,
    sessionId: string | null,
    reservationId: string | null,
    subscriptionId: string | null,
    amount: number | undefined,
    paymentMethod: string,
    status: string,
    type: string,
  ) {
    if (amount !== undefined && amount < 0) {
      return {
        error: PbmsResponseDto.fail('Số tiền thanh toán không được âm'),
        userId: null,
        sessionId: null,
        reservationId: null,
        subscriptionId: null,
        method: '',
        status: '',
        type: '',
      };
    }
    const method = METHODS.find((item) => item.toLowerCase() === paymentMethod.trim().toLowerCase());
    if (!method) {
      return this.invalid('Phương thức thanh toán chỉ được là PayOS, Cash hoặc Wallet');
    }
    const normalizedStatus = STATUSES.find((item) => item.toLowerCase() === status.trim().toLowerCase());
    if (!normalizedStatus) {
      return this.invalid('Trạng thái thanh toán chỉ được là Pending, Success hoặc Failed');
    }
    const normalizedType = TYPES.find((item) => item.toLowerCase() === type.trim().toLowerCase());
    if (!normalizedType) {
      return this.invalid('Loại thanh toán không hợp lệ');
    }
    if (sameStatus(normalizedType, 'Deposit') && !reservationId) {
      return this.invalid('Thanh toán đặt cọc cần ReservationId');
    }
    if (sameStatus(normalizedType, 'CheckoutFee') && !sessionId) {
      return this.invalid('Thanh toán checkout cần SessionId');
    }
    if (
      (sameStatus(normalizedType, 'SubscriptionFee') || sameStatus(normalizedType, 'SubscriptionRenewal')) &&
      !subscriptionId
    ) {
      return this.invalid('Thanh toán gói tháng cần SubscriptionId');
    }
    if (userId && !(await this.prisma.user.findUnique({ where: { id: userId } }))) {
      return this.invalid('Người dùng không tồn tại');
    }
    if (sessionId && !(await this.prisma.parkingSession.findUnique({ where: { id: sessionId } }))) {
      return this.invalid('Phiên gửi xe không tồn tại');
    }
    if (reservationId && !(await this.prisma.reservation.findUnique({ where: { id: reservationId } }))) {
      return this.invalid('Đặt chỗ không tồn tại');
    }
    if (subscriptionId && !(await this.prisma.monthlySubscription.findUnique({ where: { id: subscriptionId } }))) {
      return this.invalid('Gói tháng không tồn tại');
    }
    return {
      error: null as PbmsResponseDto | null,
      userId: userId || null,
      sessionId: sessionId || null,
      reservationId: reservationId || null,
      subscriptionId: subscriptionId || null,
      method,
      status: normalizedStatus,
      type: normalizedType,
    };
  }

  private invalid(message: string) {
    return {
      error: PbmsResponseDto.fail(message),
      userId: null as string | null,
      sessionId: null as string | null,
      reservationId: null as string | null,
      subscriptionId: null as string | null,
      method: '',
      status: '',
      type: '',
    };
  }
}
