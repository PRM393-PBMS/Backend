import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PayosService } from '../integrations/payos-files.service';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import {
  errorMessage,
  isEmptyGuid,
  pbmsPick,
  pbmsPickDate,
  pbmsPickGuid,
  sameStatus,
  toMoney,
} from '../common/pbms-fields';
import { createTicket } from '../common/qr.util';
import { NotificationsService, formatTime } from '../notifications/notifications.service';

const QUOTA = 0.2;

const STATUS_LABELS: Record<string, string> = {
  pending: 'chờ thanh toán cọc',
  confirmed: 'đã xác nhận',
  modified: 'đã đổi giờ',
  checkedin: 'đã vào bãi',
  completed: 'đã hoàn tất',
  cancelled: 'đã bị huỷ',
  noshow: 'đã hết hiệu lực do không đến',
};

@Injectable()
export class ReservationsService {
  private readonly logger = new Logger(ReservationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payos: PayosService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  async create(userId: string, dto: object): Promise<PbmsResponseDto> {
    const vehicleId = pbmsPickGuid(dto, 'vehicleId', 'VehicleId');
    const expected = pbmsPickDate(dto, 'expectedEntryTime', 'ExpectedEntryTime');
    if (!expected) {
      return PbmsResponseDto.fail('Vui lòng nhập thời gian vào');
    }
    const now = new Date();
    if (expected <= now) {
      return PbmsResponseDto.fail('Thời gian vào phải lớn hơn thời gian hiện tại');
    }
    if (expected > new Date(now.getTime() + 5 * 60 * 60 * 1000)) {
      return PbmsResponseDto.fail('Chỉ được phép đặt trước tối đa 5 tiếng');
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return PbmsResponseDto.fail('Không tìm thấy người dùng', 404);
    }
    if (isEmptyGuid(vehicleId)) {
      return PbmsResponseDto.fail('Vui lòng chọn xe để đặt chỗ');
    }
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, userId },
      include: { vehicleType: true },
    });
    if (!vehicle) {
      return PbmsResponseDto.fail('Không tìm thấy xe hoặc xe không thuộc tài khoản của bạn', 404);
    }
    if (!sameStatus(vehicle.vehicleType.typeName, 'Ô tô')) {
      return PbmsResponseDto.fail('Đặt chỗ trước hiện chỉ áp dụng cho xe ô tô');
    }
    const quotaError = await this.assertQuota(vehicle.vehicleTypeId, null);
    if (quotaError) {
      return quotaError;
    }
    const pricing = await this.activePolicy(vehicle.vehicleTypeId);
    if (!pricing) {
      return PbmsResponseDto.fail('Không tìm thấy chính sách giá', 404);
    }
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const reservation = await tx.reservation.create({
          data: {
            userId,
            vehicleId: vehicle.id,
            expectedEntryTime: expected,
            status: 'Pending',
          },
        });
        const payment = await tx.payment.create({
          data: {
            userId,
            reservationId: reservation.id,
            amount: pricing.basePrice,
            paymentMethod: 'PayOS',
            paymentStatus: 'Pending',
            paymentType: 'Deposit',
            paymentTime: new Date(),
            transactionReference: '',
          },
        });
        return { reservation, payment };
      });
      const link = await this.payos.createPaymentLink(created.payment);
      await this.prisma.payment.update({
        where: { id: created.payment.id },
        data: { transactionReference: link.orderCode },
      });
      const ticket = await createTicket(created.reservation.id);
      return PbmsResponseDto.ok('Reservation created successfully', {
        reservationId: created.reservation.id,
        paymentId: created.payment.id,
        depositAmount: toMoney(created.payment.amount),
        paymentLinkId: link.paymentLinkId,
        paymentUrl: link.paymentUrl,
        orderCode: link.orderCode,
        ticket,
      });
    } catch (error: unknown) {
      return PbmsResponseDto.fail(errorMessage(error), 500);
    }
  }

  async changeTime(reservationId: string, body: unknown): Promise<PbmsResponseDto> {
    const newExpected =
      pbmsPickDate(body, 'newExpectedTime', 'NewExpectedTime') ??
      (typeof body === 'string' || body instanceof Date ? pbmsPickDate(body) : undefined);
    if (!newExpected) {
      return PbmsResponseDto.fail('Vui lòng nhập giờ hẹn mới');
    }
    const reservation = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
      include: { vehicle: true },
    });
    if (!reservation) {
      return PbmsResponseDto.fail('Không tìm thấy thông tin đặt chỗ', 404);
    }
    if (sameStatus(reservation.status, 'Modified')) {
      return PbmsResponseDto.fail('Bạn đã hết lượt đổi giờ cho mã đặt chỗ này (Tối đa 1 lần)');
    }
    if (!sameStatus(reservation.status, 'Confirmed')) {
      return PbmsResponseDto.fail('Chỉ đơn đặt chỗ đã thanh toán thành công mới được đổi giờ');
    }
    const now = new Date();
    if (now > new Date(reservation.expectedEntryTime.getTime() + 30 * 60 * 1000)) {
      await this.prisma.reservation.update({
        where: { id: reservationId },
        data: { status: 'NoShow' },
      });
      return PbmsResponseDto.fail(
        'Đơn đặt chỗ đã bị hủy (NoShow) do quá hạn 30 phút không check-in. Không thể đổi giờ.',
      );
    }
    if (newExpected <= now) {
      return PbmsResponseDto.fail('Giờ hẹn mới phải lớn hơn thời gian hiện tại');
    }
    if (newExpected > new Date(now.getTime() + 5 * 60 * 60 * 1000)) {
      return PbmsResponseDto.fail('Giờ hẹn mới không được vượt quá 5 tiếng tính từ thời điểm hiện tại');
    }
    if (now >= new Date(reservation.expectedEntryTime.getTime() - 15 * 60 * 1000)) {
      return PbmsResponseDto.fail('Phải thực hiện đổi lịch trước giờ hẹn cũ ít nhất 15 phút.');
    }
    const quotaError = await this.assertQuota(reservation.vehicle.vehicleTypeId, reservation.id);
    if (quotaError) {
      return quotaError;
    }
    const updated = await this.prisma.reservation.update({
      where: { id: reservationId },
      data: { expectedEntryTime: newExpected, status: 'Modified' },
      include: { user: true, vehicle: { include: { vehicleType: true, user: true } } },
    });
    return PbmsResponseDto.ok('Đổi giờ đặt chỗ thành công', await this.map(updated));
  }

  async recreatePayment(id: string, userId: string): Promise<PbmsResponseDto> {
    const reservation = await this.prisma.reservation.findUnique({ where: { id } });
    if (!reservation) {
      return PbmsResponseDto.fail('Không tìm thấy thông tin đặt chỗ', 404);
    }
    if (reservation.userId !== userId) {
      return PbmsResponseDto.fail('Bạn không có quyền thanh toán đặt chỗ này', 403);
    }
    if (!sameStatus(reservation.status, 'Pending')) {
      return PbmsResponseDto.fail('Chỉ đơn chờ thanh toán mới được tạo lại liên kết');
    }
    let payment = await this.prisma.payment.findFirst({
      where: { reservationId: id, paymentType: 'Deposit', paymentStatus: 'Pending' },
      orderBy: { paymentTime: 'desc' },
    });
    if (!payment) {
      const reservationWithVehicle = await this.prisma.reservation.findUnique({
        where: { id },
        include: { vehicle: true },
      });
      if (!reservationWithVehicle) {
        return PbmsResponseDto.fail('Không tìm thấy thông tin xe đặt chỗ', 404);
      }
      const pricing = await this.activePolicy(reservationWithVehicle.vehicle.vehicleTypeId);
      if (!pricing) {
        return PbmsResponseDto.fail('Không tìm thấy chính sách giá', 404);
      }
      payment = await this.prisma.payment.create({
        data: {
          userId,
          reservationId: id,
          amount: pricing.basePrice,
          paymentMethod: 'PayOS',
          paymentStatus: 'Pending',
          paymentType: 'Deposit',
          paymentTime: new Date(),
          transactionReference: '',
        },
      });
    }
    const link = await this.payos.createPaymentLink(payment);
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: { transactionReference: link.orderCode },
    });
    return PbmsResponseDto.ok('Tạo lại liên kết thanh toán thành công', {
      reservationId: id,
      paymentId: payment.id,
      depositAmount: toMoney(payment.amount),
      paymentLinkId: link.paymentLinkId,
      paymentUrl: link.paymentUrl,
      orderCode: link.orderCode,
      ticket: await createTicket(id),
    });
  }

  async getMine(userId: string): Promise<PbmsResponseDto> {
    const items = await this.prisma.reservation.findMany({
      where: { userId },
      include: { user: true, vehicle: { include: { vehicleType: true, user: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return PbmsResponseDto.ok(
      'Lấy danh sách đặt chỗ thành công',
      await Promise.all(items.map((item) => this.map(item))),
    );
  }

  async getById(id: string, userId: string, role: string): Promise<PbmsResponseDto> {
    const item = await this.prisma.reservation.findUnique({
      where: { id },
      include: { user: true, vehicle: { include: { vehicleType: true, user: true } } },
    });
    if (!item) {
      return PbmsResponseDto.fail('Không tìm thấy thông tin đặt chỗ', 404);
    }
    if (!this.canManage(role) && item.userId !== userId) {
      return PbmsResponseDto.fail('Bạn không có quyền xem đặt chỗ này', 403);
    }
    return PbmsResponseDto.ok('Lấy thông tin đặt chỗ thành công', await this.map(item));
  }

  async cancel(id: string, userId: string): Promise<PbmsResponseDto> {
    const item = await this.prisma.reservation.findUnique({ where: { id } });
    if (!item) {
      return PbmsResponseDto.fail('Không tìm thấy thông tin đặt chỗ', 404);
    }
    if (item.userId !== userId) {
      return PbmsResponseDto.fail('Bạn không có quyền hủy đặt chỗ này', 403);
    }
    if (sameStatus(item.status, 'CheckedIn') || sameStatus(item.status, 'Completed')) {
      return PbmsResponseDto.fail('Không thể hủy đặt chỗ đã check-in');
    }
    await this.prisma.reservation.update({ where: { id }, data: { status: 'Cancelled' } });
    return PbmsResponseDto.ok('Hủy đặt chỗ thành công');
  }

  async checkPaymentStatus(orderCode: string): Promise<PbmsResponseDto> {
    const payment = await this.prisma.payment.findFirst({
      where: { transactionReference: orderCode },
    });
    if (!payment) {
      return PbmsResponseDto.fail('Không tìm thấy thanh toán', 404);
    }
    const ticket = payment.reservationId ? await createTicket(payment.reservationId) : null;
    return PbmsResponseDto.ok('Lấy trạng thái thanh toán thành công', {
      paymentId: payment.id,
      reservationId: payment.reservationId,
      paymentStatus: payment.paymentStatus,
      amount: toMoney(payment.amount),
      orderCode: payment.transactionReference,
      ticket,
    });
  }

  async getAll(status?: string, date?: string): Promise<PbmsResponseDto> {
    const where: Prisma.ReservationWhereInput = {};
    if (status?.trim()) {
      where.status = status.trim();
    }
    if (date?.trim()) {
      const start = new Date(date);
      if (!Number.isNaN(start.getTime())) {
        const end = new Date(start);
        end.setUTCDate(end.getUTCDate() + 1);
        where.expectedEntryTime = { gte: start, lt: end };
      }
    }
    const items = await this.prisma.reservation.findMany({
      where,
      include: { user: true, vehicle: { include: { vehicleType: true, user: true } } },
      orderBy: { expectedEntryTime: 'desc' },
    });
    return PbmsResponseDto.ok(
      'Lấy danh sách đặt chỗ thành công',
      await Promise.all(items.map((item) => this.map(item))),
    );
  }

  async updateStatus(id: string, dto: object): Promise<PbmsResponseDto> {
    const status = pbmsPick(dto, 'status', 'Status').trim();
    if (!status) {
      return PbmsResponseDto.fail('Vui lòng nhập trạng thái');
    }
    const existing = await this.prisma.reservation.findUnique({
      where: { id },
      include: { user: true, vehicle: { include: { vehicleType: true, user: true } } },
    });
    if (!existing) {
      return PbmsResponseDto.fail('Không tìm thấy thông tin đặt chỗ', 404);
    }
    const updated = await this.prisma.reservation.update({
      where: { id },
      data: { status },
      include: { user: true, vehicle: { include: { vehicleType: true, user: true } } },
    });
    if (!sameStatus(existing.status, status)) {
      const label = STATUS_LABELS[status.toLowerCase()] ?? status;
      await this.notifications?.notify(updated.userId, {
        title: 'Cập nhật đặt chỗ',
        message: `Đặt chỗ xe ${updated.vehicle.licensePlate} lúc ${formatTime(updated.expectedEntryTime)} ${label}.`,
        type: 'reservation',
        metadata: { reservationId: id, status },
      });
    }
    return PbmsResponseDto.ok('Cập nhật trạng thái đặt chỗ thành công', await this.map(updated));
  }

  @Cron('* * * * *')
  async processOverdueReservations(): Promise<void> {
    const cutoff = new Date(Date.now() - 30 * 60 * 1000);
    const overdue = await this.prisma.reservation.findMany({
      where: {
        expectedEntryTime: { lte: cutoff },
        status: { in: ['Pending', 'Confirmed', 'Modified'] },
      },
      include: { vehicle: true },
    });
    for (const item of overdue) {
      await this.prisma.reservation.update({
        where: { id: item.id },
        data: { status: 'NoShow' },
      });
      await this.notifications?.notify(item.userId, {
        title: 'Đặt chỗ đã hết hiệu lực',
        message: `Xe ${item.vehicle.licensePlate} không vào bãi trong 30 phút sau giờ hẹn ${formatTime(item.expectedEntryTime)}, đặt chỗ đã bị huỷ.`,
        type: 'reservation',
        metadata: { reservationId: item.id, status: 'NoShow' },
      });
    }
    if (overdue.length > 0) {
      this.logger.log(`Đã chuyển ${overdue.length} đặt chỗ quá hạn sang NoShow`);
    }
  }

  private canManage(role: string): boolean {
    const value = role.trim().toLowerCase();
    return value === 'manager' || value === 'staff';
  }

  private async assertQuota(vehicleTypeId: string, excludeId: string | null) {
    const totalCarCapacity = await this.prisma.parkingSlot.count({
      where: { vehicleTypeId, floor: { isResident: false } },
    });
    if (totalCarCapacity === 0) {
      return PbmsResponseDto.fail('Hệ thống hiện tại không có slot Ô tô vãng lai hợp lệ');
    }
    const maxSlots = Math.floor(totalCarCapacity * QUOTA);
    const current = await this.prisma.reservation.count({
      where: {
        vehicle: { is: { vehicleTypeId } },
        status: { in: ['Confirmed', 'Modified'] },
        ...(excludeId ? { NOT: { id: excludeId } } : {}),
      },
    });
    if (current >= maxSlots) {
      return PbmsResponseDto.fail(
        'Hệ thống đã hết chỗ nhận đặt trước. Vui lòng vào trực tiếp hoặc chọn khung giờ khác.',
      );
    }
    return null;
  }

  private activePolicy(vehicleTypeId: string) {
    return this.prisma.pricingPolicy.findFirst({
      where: {
        vehicleTypeId,
        status: 'Active',
        effectiveDate: { lte: new Date() },
      },
      orderBy: { effectiveDate: 'desc' },
    });
  }

  private async map(item: {
    id: string;
    userId: string;
    vehicleId: string;
    expectedEntryTime: Date;
    status: string;
    createdAt: Date | null;
    user: { fullName: string | null };
    vehicle: {
      licensePlate: string;
      vehicleTypeId: string;
      vehicleType: { typeName: string };
      user: { id: string; fullName: string | null };
    };
  }) {
    const deposit = await this.prisma.payment.findFirst({
      where: { reservationId: item.id, paymentType: 'Deposit' },
      orderBy: { paymentTime: 'desc' },
      select: { amount: true },
    });
    return {
      reservationId: item.id,
      userId: item.userId,
      userFullName: item.user.fullName ?? '',
      vehicleId: item.vehicleId,
      licensePlate: item.vehicle.licensePlate,
      vehicleTypeId: item.vehicle.vehicleTypeId,
      vehicleTypeName: item.vehicle.vehicleType.typeName,
      vehicleOwnerId: item.vehicle.user.id,
      vehicleOwnerFullName: item.vehicle.user.fullName,
      expectedEntryTime: item.expectedEntryTime,
      status: item.status,
      createdAt: item.createdAt,
      depositAmount: deposit ? toMoney(deposit.amount) : null,
      ticket: await createTicket(item.id),
    };
  }
}
