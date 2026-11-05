import { paymentApplication } from '../common/payment-state';
import type {
  PaymentResultState,
  PaymentResultView,
} from './payment-result.page';
import { activateSubscription } from '../subscriptions/activate-subscription';
import { AppError, logFailure } from '../common/errors';
import { Db, lockResource } from '../common/transactions';
import { Cron } from '@nestjs/schedule';
import { Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import { isEmptyGuid, sameStatus, toMoney } from '../common/pbms-fields';
import { WalletsService } from '../wallets/wallets.service';
import { PayosService } from '../integrations/payos-files.service';
import { issueExitPass } from '../common/exit-pass';
import {
  NotificationsService,
  formatVnd,
} from '../notifications/notifications.service';

export const PAYMENT_TYPE_LABELS: Record<string, string> = {
  Deposit: 'Tiền cọc đặt chỗ',
  SubscriptionFee: 'Vé tháng',
  SubscriptionRenewal: 'Gia hạn vé tháng',
  CheckoutFee: 'Phí gửi xe',
  WalletTopUp: 'Nạp ví PBMS',
  PrepaidCheckout: 'Thanh toán trước khi ra bãi',
};

const STATUSES = ['Pending', 'Success', 'Failed', 'Refunded'];
const MY_PAGE_SIZE_DEFAULT = 20;
const MY_PAGE_SIZE_MAX = 50;

@Injectable()
export class PaymentsService {
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
    appliedAt?: Date | null;
    reconciliationReason?: string | null;
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
      ...paymentApplication(payment),
      transactionReference: payment.transactionReference,
    };
  }

  async getAll(): Promise<PbmsResponseDto> {
    const payments = await this.prisma.payment.findMany({
      orderBy: { paymentTime: 'desc' },
    });
    return PbmsResponseDto.ok(
      'Lấy danh sách thanh toán thành công',
      payments.map((p) => this.mapPayment(p)),
    );
  }

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
      Math.max(
        1,
        Number.parseInt(pageSizeRaw ?? '', 10) || MY_PAGE_SIZE_DEFAULT,
      ),
    );
    const status = STATUSES.find((s) => sameStatus(s, statusRaw?.trim() ?? ''));
    if (statusRaw?.trim() && !status) {
      return PbmsResponseDto.fail(
        `Trạng thái lọc phải là một trong: ${STATUSES.join(', ')}`,
      );
    }
    const where: Prisma.PaymentWhereInput = {
      userId,
      ...(status ? { paymentStatus: status } : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.payment.count({ where }),
      this.prisma.payment.findMany({
        where,
        include: {
          session: { select: { licensePlateIn: true } },
          reservation: {
            select: { vehicle: { select: { licensePlate: true } } },
          },
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
        paymentTypeLabel:
          PAYMENT_TYPE_LABELS[p.paymentType ?? ''] ?? p.paymentType,
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

  async resultForOrderCode(
    orderCode: string | undefined,
    cancelled: boolean,
  ): Promise<PaymentResultView> {
    const code = (orderCode ?? '').trim();
    if (!/^\d{1,20}$/.test(code)) {
      return { state: 'unknown', orderCode: '', amount: null, typeLabel: null };
    }
    const payment = await this.prisma.payment.findFirst({
      where: { transactionReference: code, paymentMethod: 'PayOS' },
    });
    if (!payment) {
      return {
        state: 'unknown',
        orderCode: code,
        amount: null,
        typeLabel: null,
      };
    }
    let status = payment.paymentStatus;
    try {
      status = await this.syncPayosPayment(payment.id);
    } catch {
      // PayOS không phản hồi: hiện trạng thái đang có, app sẽ kiểm tra lại sau.
    }
    const fresh = await this.prisma.payment.findUniqueOrThrow({
      where: { id: payment.id },
    });
    const state: PaymentResultState = paymentApplication(fresh).isApplied
      ? 'success'
      : sameStatus(status, 'Success')
        ? 'pending'
        : sameStatus(status, 'Failed')
          ? cancelled
            ? 'cancelled'
            : 'failed'
          : 'pending';
    return {
      state,
      orderCode: code,
      amount: toMoney(payment.amount),
      typeLabel:
        PAYMENT_TYPE_LABELS[payment.paymentType ?? ''] ?? 'Thanh toán PBMS',
    };
  }

  async getById(id: string): Promise<PbmsResponseDto> {
    if (isEmptyGuid(id)) {
      return PbmsResponseDto.fail('Vui lòng nhập PaymentId');
    }
    const payment = await this.prisma.payment.findUnique({ where: { id } });
    if (!payment) {
      return PbmsResponseDto.fail('Không tìm thấy thanh toán', 404);
    }
    return PbmsResponseDto.ok(
      'Lấy thông tin thanh toán thành công',
      this.mapPayment(payment),
    );
  }

  async create(_dto: object): Promise<PbmsResponseDto> {
    throw new AppError(
      409,
      'USE_PAYMENT_WORKFLOW',
      'Thanh toán phải được tạo qua checkout, nạp ví hoặc đăng ký/gia hạn vé tháng',
    );
  }

  async update(_dto: object): Promise<PbmsResponseDto> {
    throw new AppError(
      409,
      'USE_PAYMENT_WORKFLOW',
      'Dùng xác nhận tiền mặt, đồng bộ PayOS hoặc hủy checkout để đổi trạng thái thanh toán',
    );
  }

  async remove(_id: string): Promise<PbmsResponseDto> {
    throw new AppError(
      409,
      'PAYMENT_HISTORY_PROTECTED',
      'Không thể xóa chứng từ thanh toán; hãy hủy yêu cầu theo luồng nghiệp vụ',
    );
  }

  async handleWebhook(body: Record<string, unknown>): Promise<void> {
    this.payos.verifyWebhook(body);
    const data = body.data as Record<string, unknown>;
    const orderCode = String(data.orderCode ?? '');
    const payment = await this.prisma.payment.findFirst({
      where: { transactionReference: orderCode, paymentMethod: 'PayOS' },
    });
    if (!payment) return;
    await this.syncPayosPayment(payment.id);
  }

  async syncPayosPayment(paymentId: string): Promise<string> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });
    if (!payment) return 'Failed';
    if (payment.paymentStatus === 'Success') {
      await this.dispatchPayment(payment.id);
      return 'Success';
    }
    if (payment.paymentMethod !== 'PayOS' || !payment.transactionReference)
      return payment.paymentStatus;
    const remote = await this.payos.getPaymentStatus(
      payment.transactionReference,
    );
    const paid =
      remote.status === 'PAID' &&
      remote.amount === Number(payment.amount) &&
      remote.amountPaid === Number(payment.amount);
    if (remote.status === 'PAID' && !paid) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { reconciliationReason: 'AMOUNT_MISMATCH' },
      });
      return payment.paymentStatus;
    }
    if (paid) {
      await this.prisma.payment.updateMany({
        where: { id: payment.id, paymentStatus: { not: 'Success' } },
        data: { paymentStatus: 'Success', paymentTime: new Date() },
      });
      await this.dispatchPayment(payment.id);
      return 'Success';
    }
    if (['CANCELLED', 'EXPIRED'].includes(remote.status)) {
      await this.prisma.payment.updateMany({
        where: { id: payment.id, paymentStatus: 'Pending' },
        data: { paymentStatus: 'Failed' },
      });
      if (payment.paymentType === 'CheckoutFee')
        await this.restoreCheckoutSession(payment.sessionId);
      return 'Failed';
    }
    return payment.paymentStatus;
  }

  async getReconciliation(): Promise<PbmsResponseDto> {
    const items = await this.prisma.payment.findMany({
      where: {
        OR: [
          { reconciliationReason: { not: null } },
          { paymentStatus: 'Success', appliedAt: null },
        ],
      },
      orderBy: [{ paymentTime: 'asc' }, { id: 'asc' }],
      take: 200,
    });
    return PbmsResponseDto.ok(
      'Danh sách thanh toán cần đối soát',
      items.map((p) => ({
        ...this.mapPayment(p),
        appliedAt: p.appliedAt,
        reconciliationReason: p.reconciliationReason,
      })),
    );
  }

  @Cron('*/1 * * * *')
  async recoverPayments(): Promise<void> {
    const pending = await this.prisma.payment.findMany({
      where: {
        paymentMethod: 'PayOS',
        paymentStatus: 'Pending',
        transactionReference: { not: null },
      },
      take: 50,
      orderBy: { paymentTime: 'asc' },
    });
    for (const item of pending) {
      if (!item.transactionReference) continue;
      try {
        await this.syncPayosPayment(item.id);
      } catch (error) {
        logFailure(error);
      }
    }
    const items = await this.prisma.payment.findMany({
      where: {
        paymentStatus: 'Success',
        appliedAt: null,
        reconciliationReason: null,
      },
      take: 50,
      orderBy: { paymentTime: 'asc' },
    });
    for (const p of items) {
      try {
        await this.dispatchPayment(p.id);
      } catch (error) {
        logFailure(error);
      }
    }
  }

  /** Khách tự kiểm tra một thanh toán PayOS của mình (nạp ví, thanh toán trước, gói tháng). */
  async syncMine(paymentId: string, userId: string): Promise<PbmsResponseDto> {
    if (isEmptyGuid(paymentId)) {
      return PbmsResponseDto.fail('PaymentId không hợp lệ');
    }
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });
    if (!payment || payment.userId !== userId) {
      return PbmsResponseDto.fail('Không tìm thấy thanh toán', 404);
    }
    try {
      const status = await this.syncPayosPayment(payment.id);
      const fresh = await this.prisma.payment.findUniqueOrThrow({
        where: { id: payment.id },
      });
      return PbmsResponseDto.ok('Lấy trạng thái thanh toán thành công', {
        paymentId: payment.id,
        paymentType: payment.paymentType,
        paymentStatus: status,
        ...paymentApplication(fresh),
        ...(sameStatus(payment.paymentType ?? '', 'WalletTopUp')
          ? await this.wallets.getBalanceForUser(userId)
          : {}),
      });
    } catch (error: unknown) {
      return PbmsResponseDto.fromError(error);
    }
  }

  /** Áp dụng một thanh toán đã thành công rồi báo cho khách. */
  async dispatchPayment(paymentId: string): Promise<void> {
    const initial = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });
    if (
      !initial ||
      initial.paymentStatus !== 'Success' ||
      initial.appliedAt ||
      initial.reconciliationReason
    )
      return;
    try {
      const applied = await this.prisma.$transaction(async (tx) => {
        await lockResource(
          tx,
          initial.sessionId
            ? 'session:' + initial.sessionId
            : initial.subscriptionId
              ? 'subscription:' + initial.subscriptionId
              : initial.reservationId
                ? 'reservation:' + initial.reservationId
                : 'wallet:' + initial.userId,
        );
        await lockResource(tx, 'payment:' + paymentId);
        const fresh = await tx.payment.findUniqueOrThrow({
          where: { id: paymentId },
        });
        if (fresh.appliedAt || fresh.reconciliationReason) return false;
        await this.applyPaidPayment(paymentId, tx);
        await tx.payment.update({
          where: { id: paymentId },
          data: { appliedAt: new Date() },
        });
        return true;
      });
      if (applied) {
        try {
          await this.notifyPaid(paymentId);
        } catch (notificationError) {
          logFailure(notificationError);
        }
      }
    } catch (error) {
      if (error instanceof AppError && [404, 409].includes(error.getStatus())) {
        const reason = (error.getResponse() as { errorCode: string }).errorCode;
        await this.prisma.payment.updateMany({
          where: { id: paymentId, appliedAt: null },
          data: { reconciliationReason: reason },
        });
        return;
      }
      throw error;
    }
  }

  private async notifyPaid(paymentId: string): Promise<void> {
    if (!this.notifications) return;
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        session: { select: { licensePlateIn: true } },
        // Tiền tặng của mã khuyến mãi nạp ví (nếu có).
        walletTransactions: {
          where: { bucket: 'BONUS', amount: { gt: 0 } },
          select: { amount: true },
        },
      },
    });
    if (!payment || !sameStatus(payment.paymentStatus, 'Success')) return;
    const amount = formatVnd(toMoney(payment.amount));
    const bonus = payment.walletTransactions?.[0]?.amount;
    const type = payment.paymentType ?? '';
    const note = sameStatus(type, 'Deposit')
      ? {
          title: 'Đặt chỗ đã được xác nhận',
          message: `Đã nhận tiền cọc ${amount}. Chỗ ô tô của bạn được giữ tới giờ hẹn.`,
          type: 'reservation' as const,
        }
      : sameStatus(type, 'SubscriptionFee')
        ? {
            title: 'Vé tháng đã kích hoạt',
            message: `Đã thanh toán ${amount}. Vé tháng của bạn đã được kích hoạt.`,
            type: 'subscription' as const,
          }
        : sameStatus(type, 'SubscriptionRenewal')
          ? {
              title: 'Đã gia hạn vé tháng',
              message: `Đã thanh toán ${amount} để gia hạn vé tháng.`,
              type: 'subscription' as const,
            }
          : sameStatus(type, 'WalletTopUp')
            ? {
                title: 'Nạp ví thành công',
                message: `Đã cộng ${amount} vào ví PBMS.${bonus ? ` Tặng thêm ${formatVnd(toMoney(bonus))} khuyến mãi.` : ''}`,
                type: 'wallet' as const,
              }
            : sameStatus(type, 'PrepaidCheckout')
              ? {
                  title: 'Đã thanh toán trước',
                  message: `Đã nhận ${amount}. Mã ra cổng đã sẵn sàng, có hiệu lực 15 phút.`,
                  type: 'payment' as const,
                }
              : sameStatus(type, 'CheckoutFee')
                ? {
                    title: 'Đã thanh toán phí gửi xe',
                    message: `Đã nhận ${amount}. Cảm ơn bạn đã gửi xe tại PBMS.`,
                    type: 'payment' as const,
                  }
                : null;
    if (!note) return;
    const metadata = { paymentId: payment.id, paymentType: type };
    if (payment.userId) {
      await this.notifications.notify(payment.userId, { ...note, metadata });
    } else {
      // Thanh toán tại cổng của xe đã đăng ký nhưng không gắn tài khoản: báo cho chủ xe.
      await this.notifications.notifyPlateOwner(
        payment.session?.licensePlateIn,
        { ...note, metadata },
      );
    }
  }

  private async applyPaidPayment(paymentId: string, db: Db): Promise<void> {
    const payment = await db.payment.findUnique({ where: { id: paymentId } });
    if (!payment || !sameStatus(payment.paymentStatus, 'Success')) {
      return;
    }
    const type = payment.paymentType ?? '';
    if (sameStatus(type, 'Deposit')) {
      if (!payment.reservationId) {
        throw new AppError(
          409,
          'PAYMENT_APPLICATION_CONFLICT',
          `Không thể xác nhận đặt chỗ cho thanh toán ${payment.id}: thiếu ReservationId.`,
        );
      }
      const reservation = await db.reservation.findUnique({
        where: { id: payment.reservationId },
      });
      if (!reservation) {
        throw new AppError(
          409,
          'PAYMENT_APPLICATION_CONFLICT',
          `Thanh toán ${payment.id} thành công nhưng không tìm thấy đặt chỗ ${payment.reservationId}.`,
        );
      }
      if (
        !['Pending', 'Confirmed', 'Modified'].includes(reservation.status) ||
        (reservation.status === 'Pending' &&
          (reservation.createdAt?.getTime() ?? 0) < Date.now() - 15 * 60000) ||
        reservation.expectedEntryTime < new Date(Date.now() - 30 * 60 * 1000)
      )
        throw new AppError(
          409,
          'LATE_DEPOSIT',
          'Đặt chỗ không còn hợp lệ; thanh toán cần đối soát',
        );
      const duplicate = await db.payment.findFirst({
        where: {
          reservationId: reservation.id,
          id: { not: payment.id },
          paymentType: 'Deposit',
          appliedAt: { not: null },
        },
      });
      if (duplicate)
        throw new AppError(
          409,
          'DUPLICATE_DEPOSIT',
          'Đặt chỗ đã nhận tiền cọc',
        );
      const confirmed = await db.reservation.updateMany({
        where: { id: reservation.id, status: reservation.status },
        data: { status: 'Confirmed' },
      });
      if (confirmed.count !== 1)
        throw new AppError(
          409,
          'LATE_DEPOSIT',
          'Đặt chỗ vừa đổi trạng thái; khoản thu cần đối soát',
        );
      return;
    }
    if (sameStatus(type, 'SubscriptionFee')) {
      if (!payment.subscriptionId) {
        throw new AppError(
          409,
          'PAYMENT_APPLICATION_CONFLICT',
          `Không thể kích hoạt gói tháng cho thanh toán ${payment.id}: thiếu SubscriptionId.`,
        );
      }
      await activateSubscription(db, payment.subscriptionId);
      return;
    }
    if (sameStatus(type, 'SubscriptionRenewal')) {
      if (!payment.subscriptionId) {
        throw new AppError(
          409,
          'PAYMENT_APPLICATION_CONFLICT',
          `Không thể gia hạn gói tháng cho thanh toán ${payment.id}: thiếu SubscriptionId.`,
        );
      }
      await this.completeRenewal(payment, db);
      return;
    }
    if (sameStatus(type, 'CheckoutFee')) {
      await this.completeCheckoutSession(payment, db);
      return;
    }
    if (sameStatus(type, 'WalletTopUp')) {
      if (!payment.userId) {
        throw new AppError(
          409,
          'PAYMENT_APPLICATION_CONFLICT',
          `Không thể cộng ví cho thanh toán ${payment.id}: thiếu UserId.`,
        );
      }
      await this.wallets.creditFromPayment(db, payment);
      return;
    }
    if (sameStatus(type, 'PrepaidCheckout')) {
      if (!payment.sessionId) {
        throw new AppError(
          409,
          'PAYMENT_APPLICATION_CONFLICT',
          `Thanh toán trước ${payment.id} thiếu SessionId.`,
        );
      }
      const prior = await db.payment.findFirst({
        where: {
          sessionId: payment.sessionId,
          id: { not: payment.id },
          paymentType: 'PrepaidCheckout',
          appliedAt: { gte: new Date(Date.now() - 15 * 60 * 1000) },
        },
      });
      if (prior)
        throw new AppError(
          409,
          'DUPLICATE_PREPAY',
          'Phiên đã thanh toán, khoản thu thêm cần đối soát',
        );
      const session = await db.parkingSession.findUniqueOrThrow({
        where: { id: payment.sessionId },
      });
      if (session.status !== 'Active')
        throw new AppError(409, 'SESSION_CLOSED', 'Phiên đã kết thúc');
      const priorReceipt = await db.payment.findFirst({
        where: {
          sessionId: session.id,
          id: { not: payment.id },
          paymentType: { in: ['PrepaidCheckout', 'CheckoutFee'] },
          paymentStatus: 'Success',
          appliedAt: { not: null },
          paymentTime: { gte: payment.paymentTime },
        },
      });
      if (priorReceipt)
        throw new AppError(
          409,
          'DUPLICATE_PREPAY',
          'Khoản thu về sau một thanh toán khác cần đối soát',
        );
      await issueExitPass(db, payment.sessionId);
      return;
    }
    throw new AppError(
      409,
      'PAYMENT_APPLICATION_CONFLICT',
      `Không có luồng xử lý cho loại thanh toán '${payment.paymentType}'.`,
    );
  }

  private async completeRenewal(
    payment: {
      id: string;
      subscriptionId: string | null;
      amount: Prisma.Decimal;
      renewalPackageId?: string | null;
      renewalDurationDays?: number | null;
    },
    db: Db,
  ): Promise<void> {
    if (!payment.subscriptionId) {
      return;
    }
    const subscription = await db.monthlySubscription.findUnique({
      where: { id: payment.subscriptionId },
      include: { package: true },
    });
    if (!subscription) {
      throw new AppError(
        409,
        'PAYMENT_APPLICATION_CONFLICT',
        `Thanh toán thành công nhưng không tìm thấy gói tháng ${payment.subscriptionId} để gia hạn.`,
      );
    }
    if (Number(subscription.price) <= 0) {
      throw new AppError(
        409,
        'PAYMENT_APPLICATION_CONFLICT',
        `Không thể gia hạn gói tháng ${subscription.id}: giá gói không hợp lệ.`,
      );
    }
    if (subscription.status === 'Cancelled')
      throw new AppError(409, 'SUBSCRIPTION_CANCELLED', 'Vé tháng đã hủy');
    if (!payment.renewalPackageId || !payment.renewalDurationDays)
      throw new AppError(
        409,
        'RENEWAL_SNAPSHOT_MISSING',
        'Thiếu dữ liệu gói gia hạn, cần đối soát',
      );
    await activateSubscription(db, subscription.id, true);
    const pkg = await db.subscriptionPackage.findUniqueOrThrow({
      where: { id: payment.renewalPackageId },
    });
    const oldEnd = subscription.endDate;
    const start = oldEnd < new Date() ? new Date() : oldEnd;
    const newEnd = new Date(start);
    newEnd.setUTCDate(newEnd.getUTCDate() + payment.renewalDurationDays!);
    await db.monthlySubscription.update({
      where: { id: subscription.id },
      data: {
        endDate: newEnd,
        status: 'Active',
        packageId: pkg.id,
        price: payment.amount,
      },
    });
    await db.subscriptionRenewal.create({
      data: {
        subscriptionId: subscription.id,
        oldEndDate: oldEnd,
        newEndDate: newEnd,
        amount: payment.amount,
        renewalDate: new Date(),
      },
    });
  }

  private async completeCheckoutSession(
    payment: {
      sessionId: string | null;
    },
    db: Db,
  ): Promise<void> {
    if (!payment.sessionId) {
      return;
    }
    const session = await db.parkingSession.findUnique({
      where: { id: payment.sessionId },
    });
    if (
      !session ||
      !session.exitTime ||
      !session.exitGateId ||
      session.status === 'Completed'
    )
      throw new AppError(
        409,
        'CHECKOUT_NOT_PENDING',
        'Phiên không còn chờ checkout',
      );
    await db.parkingSession.update({
      where: { id: session.id },
      data: { status: 'Completed' },
    });
    if (session.actualSlotId) {
      const slot = await db.parkingSlot.findUnique({
        where: { id: session.actualSlotId },
      });
      if (slot && sameStatus(slot.status, 'Occupied')) {
        await db.parkingSlot.update({
          where: { id: slot.id },
          data: { status: slot.assignedUserId ? 'Assigned' : 'Available' },
        });
      }
    }
    if (session.reservationId) {
      await db.reservation.update({
        where: { id: session.reservationId },
        data: { status: 'Completed' },
      });
    }
  }

  private async restoreCheckoutSession(
    sessionId: string | null,
  ): Promise<void> {
    if (!sessionId) return;
    await this.prisma.$transaction(async (tx) => {
      await lockResource(tx, 'session:' + sessionId);
      const pending = await tx.payment.findFirst({
        where: {
          sessionId,
          paymentType: 'CheckoutFee',
          paymentStatus: 'Pending',
        },
      });
      if (pending) return;
      await tx.parkingSession.updateMany({
        where: { id: sessionId, status: 'Active' },
        data: {
          exitGateId: null,
          exitTime: null,
          licensePlateOut: null,
          exitImageUrl: null,
          driverExitImageUrl: null,
        },
      });
    });
  }
}
