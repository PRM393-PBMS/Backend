import { Injectable } from '@nestjs/common';
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

const METHODS = ['PayOS', 'Cash', 'Wallet'];
const STATUSES = ['Pending', 'Success', 'Failed'];
const TYPES = ['Deposit', 'CheckoutFee', 'SubscriptionFee', 'SubscriptionRenewal', 'WalletTopUp'];

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallets: WalletsService,
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
    const code = String(body.code ?? body.Code ?? '');
    const success = code === '00';
    const marked = await this.prisma.payment.updateMany({
      where: { id: payment.id, paymentStatus: 'Pending' },
      data: {
        paymentStatus: success ? 'Success' : 'Failed',
        paymentTime: new Date(),
      },
    });
    if (marked.count !== 1) {
      return;
    }
    if (success) {
      await this.dispatchPayment(payment.id);
    } else {
      await this.restoreCheckoutSession(payment.sessionId);
    }
  }

  async dispatchPayment(paymentId: string): Promise<void> {
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
      await this.prisma.reservation.update({
        where: { id: reservation.id },
        data: { status: 'Confirmed' },
      });
      return;
    }
    if (sameStatus(type, 'SubscriptionFee')) {
      if (!payment.subscriptionId) {
        throw new Error(`Không thể kích hoạt gói tháng cho thanh toán ${payment.id}: thiếu SubscriptionId.`);
      }
      await this.activateSubscription(payment.subscriptionId);
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
    throw new Error(`Không có luồng xử lý cho loại thanh toán '${payment.paymentType}'.`);
  }

  private async activateSubscription(subscriptionId: string): Promise<void> {
    const subscription = await this.prisma.monthlySubscription.findUnique({
      where: { id: subscriptionId },
      include: { package: true, vehicleType: true, user: { include: { pbmsRole: true } } },
    });
    if (!subscription) {
      throw new Error(`Thanh toán thành công nhưng không tìm thấy đăng ký gói tháng ${subscriptionId}.`);
    }
    if (!subscription.package) {
      throw new Error(`Không thể kích hoạt gói tháng ${subscriptionId}: không tìm thấy thông tin gói đăng ký.`);
    }
    if (!isMotorbikeType(subscription.vehicleType.typeName)) {
      let slot = subscription.fixedSlotId
        ? await this.prisma.parkingSlot.findUnique({
            where: { id: subscription.fixedSlotId },
            include: { floor: true },
          })
        : null;
      if (!slot) {
        const available = await this.prisma.parkingSlot.findMany({
          where: {
            vehicleTypeId: subscription.vehicleTypeId,
            status: 'Available',
            floor: { isResident: true },
          },
          include: { floor: true },
        });
        if (available.length === 0) {
          throw new Error(
            `Không thể kích hoạt gói tháng ${subscriptionId}: không còn slot cư dân phù hợp với loại xe.`,
          );
        }
        slot = available[Math.floor(Math.random() * available.length)];
      }
      if (!slot || slot.vehicleTypeId !== subscription.vehicleTypeId || !slot.floor.isResident) {
        throw new Error(
          `Không thể kích hoạt gói tháng ${subscriptionId}: slot cố định không tồn tại hoặc không còn hợp lệ.`,
        );
      }
      await this.prisma.parkingSlot.update({
        where: { id: slot.id },
        data: { status: 'Assigned', assignedUserId: subscription.userId },
      });
      await this.prisma.monthlySubscription.update({
        where: { id: subscriptionId },
        data: { fixedSlotId: slot.id },
      });
    }

    const start = new Date();
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + subscription.package.durationDays);
    await this.prisma.$transaction(async (tx) => {
      await tx.monthlySubscription.update({
        where: { id: subscriptionId },
        data: { status: 'Active', startDate: start, endDate: end, autoRenew: true },
      });
    });
  }

  private async completeRenewal(payment: {
    id: string;
    subscriptionId: string | null;
    amount: Prisma.Decimal;
  }): Promise<void> {
    if (!payment.subscriptionId) {
      return;
    }
    const subscription = await this.prisma.monthlySubscription.findUnique({
      where: { id: payment.subscriptionId },
      include: { package: true },
    });
    if (!subscription) {
      throw new Error(
        `Thanh toán thành công nhưng không tìm thấy gói tháng ${payment.subscriptionId} để gia hạn.`,
      );
    }
    if (Number(subscription.price) <= 0) {
      throw new Error(`Không thể gia hạn gói tháng ${subscription.id}: giá gói không hợp lệ.`);
    }
    const pkg = subscription.package;
    const oldEnd = subscription.endDate;
    const start = oldEnd < new Date() ? new Date() : oldEnd;
    const newEnd = new Date(start);
    newEnd.setUTCDate(newEnd.getUTCDate() + pkg.durationDays);
    await this.prisma.$transaction([
      this.prisma.monthlySubscription.update({
        where: { id: subscription.id },
        data: { endDate: newEnd, status: 'Active' },
      }),
      this.prisma.subscriptionRenewal.create({
        data: {
          subscriptionId: subscription.id,
          oldEndDate: oldEnd,
          newEndDate: newEnd,
          amount: payment.amount,
          renewalDate: new Date(),
        },
      }),
    ]);
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
