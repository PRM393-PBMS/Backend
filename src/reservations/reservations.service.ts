import { paymentApplication } from '../common/payment-state';
import { AppError } from '../common/errors';
import { lockResource } from '../common/transactions';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PayosService } from '../integrations/payos-files.service';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import { createReservationRow } from '../common/legacy-columns';
import {
  isEmptyGuid,
  pbmsPick,
  pbmsPickDate,
  pbmsPickGuid,
  toMoney,
} from '../common/pbms-fields';
import { createTicket } from '../common/qr.util';
import {
  NotificationsService,
  formatTime,
  formatVnd,
} from '../notifications/notifications.service';
import { WalletsService } from '../wallets/wallets.service';
import {
  ENTRY_WINDOW_MS,
  HELD_STATUSES,
  HOLD_MS,
  OPEN_STATUSES,
  REFUND_MIN_BEFORE_MS,
  changeTimeError,
  entryTimeError,
  entryWindow,
  holdExpiresAt,
  is,
  isHeld,
  isHoldExpired,
  overlapRange,
  quotaOf,
  refundOnCancel,
  staffTransitionError,
  vietnamDayRange,
} from './reservation-rules';

const STATUS_LABELS: Record<string, string> = {
  pending: 'chờ thanh toán cọc',
  confirmed: 'đã xác nhận',
  modified: 'đã đổi giờ',
  checkedin: 'đã vào bãi',
  completed: 'đã hoàn tất',
  cancelled: 'đã bị huỷ',
  noshow: 'đã hết hiệu lực do không đến',
};

const CAR = 'Ô tô';

const reservationInclude = {
  user: { select: { fullName: true } },
  parking: { select: { name: true } },
  vehicle: {
    select: {
      licensePlate: true,
      vehicleTypeId: true,
      vehicleType: { select: { typeName: true } },
      user: { select: { id: true, fullName: true } },
    },
  },
} satisfies Prisma.ReservationInclude;

type ReservationRow = Prisma.ReservationGetPayload<{
  include: typeof reservationInclude;
}>;
type Db = Prisma.TransactionClient | PrismaService;

/**
 * Đặt chỗ trước cho ô tô, theo bãi khách chọn.
 *
 * Pending (chờ cọc, giữ suất 15 phút) → Confirmed / Modified (đã cọc) → CheckedIn → Completed.
 * Kết thúc sớm: Cancelled (khách / nhân viên huỷ, hết thời gian giữ suất) hoặc NoShow (đã cọc, không đến).
 * Quy tắc thời gian và hạn mức nằm trong `reservation-rules.ts`.
 */
@Injectable()
export class ReservationsService {
  private readonly logger = new Logger(ReservationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payos: PayosService,
    @Optional() private readonly notifications?: NotificationsService,
    @Optional() private readonly wallets?: WalletsService,
  ) {}

  // ------------------------------------------------------------------ khách

  async create(userId: string, dto: object): Promise<PbmsResponseDto> {
    const vehicleId = pbmsPickGuid(dto, 'vehicleId', 'VehicleId');
    const expected = pbmsPickDate(
      dto,
      'expectedEntryTime',
      'ExpectedEntryTime',
    );
    if (!expected) return PbmsResponseDto.fail('Vui lòng chọn giờ vào bãi');
    const now = new Date();
    const timeError = entryTimeError(expected, now);
    if (timeError) return PbmsResponseDto.fail(timeError);
    if (isEmptyGuid(vehicleId))
      return PbmsResponseDto.fail('Vui lòng chọn xe để đặt chỗ');

    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, userId },
      include: { vehicleType: true },
    });
    if (!vehicle) {
      return PbmsResponseDto.fail(
        'Không tìm thấy xe hoặc xe không thuộc tài khoản của bạn',
        404,
      );
    }
    if (!is(vehicle.vehicleType.typeName, CAR)) {
      return PbmsResponseDto.fail('Đặt chỗ trước hiện chỉ áp dụng cho ô tô');
    }
    const parking = await this.resolveParking(
      pbmsPickGuid(dto, 'parkingId', 'ParkingId'),
    );
    if ('error' in parking) return parking.error;

    const pricing = await this.activePolicy(vehicle.vehicleTypeId);
    if (!pricing)
      return PbmsResponseDto.fail(
        'Bãi chưa có bảng giá ô tô nên chưa nhận đặt trước',
        404,
      );

    let created: {
      reservationId: string;
      createdAt?: Date | null;
      payment: Prisma.PaymentGetPayload<object>;
    };
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        await lockResource(tx, 'gate-entry');
        await this.lockParking(tx, parking.id);
        const inside = await tx.parkingSession.findFirst({
          where: {
            licensePlateIn: vehicle.licensePlate,
            status: { in: ['Active', 'Exception'] },
          },
        });
        if (inside)
          throw new AppError(
            409,
            'VEHICLE_INSIDE',
            'Xe đang ở trong bãi, không thể đặt chỗ',
          );
        const prior = await tx.reservation.findFirst({
          where: { vehicleId: vehicle.id, status: { in: [...OPEN_STATUSES] } },
          orderBy: { createdAt: 'desc' },
        });
        if (prior) {
          if (
            prior.status === 'Pending' &&
            !isHoldExpired(prior.createdAt, now) &&
            prior.expectedEntryTime.getTime() === expected.getTime() &&
            prior.parkingId === parking.id
          ) {
            const payment = await tx.payment.findFirst({
              where: {
                reservationId: prior.id,
                paymentType: 'Deposit',
                paymentStatus: 'Pending',
              },
              orderBy: { paymentTime: 'desc' },
            });
            if (payment)
              return {
                reservationId: prior.id,
                createdAt: prior.createdAt,
                payment,
              };
          }
          throw new AppError(
            409,
            'RESERVATION_EXISTS',
            'Xe đã có đặt chỗ hoặc đang chờ cọc; hãy xử lý đơn hiện tại trước',
          );
        }
        const quota = await this.quotaError(
          tx,
          parking.id,
          expected,
          now,
          null,
        );
        if (quota) return quota;
        const reservation = await createReservationRow(tx, {
          userId,
          vehicleId: vehicle.id,
          vehicleTypeId: vehicle.vehicleTypeId,
          parkingId: parking.id,
          expectedEntryTime: expected,
          status: 'Pending',
        });
        const payment = await tx.payment.create({
          data: {
            userId,
            reservationId: reservation.id,
            amount: pricing.basePrice,
            paymentMethod: 'PayOS',
            paymentStatus: 'Pending',
            paymentType: 'Deposit',
            paymentTime: now,
            transactionReference: '',
          },
        });
        return {
          reservationId: reservation.id,
          createdAt: reservation.createdAt,
          payment,
        };
      });
      if (result instanceof PbmsResponseDto) return result;
      created = result;
    } catch (error) {
      return PbmsResponseDto.fromError(error);
    }

    let link: Awaited<ReturnType<PayosService['createPaymentLink']>>;
    try {
      link = await this.payos.createPaymentLink(created.payment);
    } catch (error) {
      // A timeout cannot prove that PayOS did not create the durable order.
      return PbmsResponseDto.fromError(error);
    }
    await this.prisma.payment.update({
      where: { id: created.payment.id },
      data: { transactionReference: link.orderCode },
    });
    return PbmsResponseDto.ok('Đã giữ chỗ, vui lòng trả cọc trong 15 phút', {
      reservationId: created.reservationId,
      parkingId: parking.id,
      parkingName: parking.name,
      paymentId: created.payment.id,
      depositAmount: toMoney(created.payment.amount),
      holdExpiresAt: new Date((created.createdAt ?? now).getTime() + HOLD_MS),
      paymentLinkId: link.paymentLinkId,
      paymentUrl: link.paymentUrl,
      orderCode: link.orderCode,
      ticket: await createTicket(created.reservationId),
    });
  }

  /** Suất đặt trước còn lại của một bãi quanh giờ vào dự kiến, kèm tiền cọc. */
  async availability(
    parkingId: string | undefined,
    time: string | undefined,
  ): Promise<PbmsResponseDto> {
    const parking = await this.resolveParking(parkingId?.trim() ?? '');
    if ('error' in parking) return parking.error;
    const now = new Date();
    const at = time ? new Date(time) : new Date(now.getTime() + 30 * 60 * 1000);
    if (Number.isNaN(at.getTime()))
      return PbmsResponseDto.fail('Giờ không hợp lệ');
    const carType = await this.prisma.vehicleType.findFirst({
      where: { typeName: { equals: CAR, mode: 'insensitive' } },
      select: { id: true },
    });
    const capacity = carType
      ? (await this.walkInCapacity(carType.id, CAR, parking.id)).capacity
      : 0;
    const quota = quotaOf(capacity);
    const used = quota
      ? await this.countHolds(this.prisma, parking.id, at, now, null)
      : 0;
    const pricing = carType ? await this.activePolicy(carType.id) : null;
    return PbmsResponseDto.ok('Lấy suất đặt trước thành công', {
      parkingId: parking.id,
      parkingName: parking.name,
      time: at,
      quota,
      used,
      remaining: Math.max(0, quota - used),
      depositAmount: pricing ? toMoney(pricing.basePrice) : null,
      timeError: entryTimeError(at, now),
    });
  }

  async getMine(userId: string): Promise<PbmsResponseDto> {
    const items = await this.prisma.reservation.findMany({
      where: { userId },
      include: reservationInclude,
      orderBy: { createdAt: 'desc' },
    });
    return PbmsResponseDto.ok(
      'Lấy danh sách đặt chỗ thành công',
      await this.mapMany(items),
    );
  }

  async getById(
    id: string,
    userId: string,
    role: string,
  ): Promise<PbmsResponseDto> {
    const item = await this.prisma.reservation.findUnique({
      where: { id },
      include: reservationInclude,
    });
    if (!item)
      return PbmsResponseDto.fail('Không tìm thấy thông tin đặt chỗ', 404);
    if (!this.canManage(role) && item.userId !== userId) {
      return PbmsResponseDto.fail('Bạn không có quyền xem đặt chỗ này', 403);
    }
    return PbmsResponseDto.ok(
      'Lấy thông tin đặt chỗ thành công',
      (await this.mapMany([item]))[0],
    );
  }

  /** Tạo lại link trả cọc cho đơn còn trong thời gian giữ suất. */
  async recreatePayment(id: string, userId: string): Promise<PbmsResponseDto> {
    let prepared: {
      reservation: { createdAt: Date | null };
      payment: Prisma.PaymentGetPayload<{}>;
    };
    try {
      prepared = await this.prisma.$transaction(async (tx) => {
        await lockResource(tx, 'reservation:' + id);
        await tx.$queryRaw`SELECT id FROM reservations WHERE id = ${id}::uuid FOR UPDATE`;
        const reservation = await tx.reservation.findUnique({ where: { id } });
        if (!reservation)
          throw new AppError(
            404,
            'RESERVATION_NOT_FOUND',
            'Không tìm thấy thông tin đặt chỗ',
          );
        if (reservation.userId !== userId)
          throw new AppError(
            403,
            'RESERVATION_FORBIDDEN',
            'Bạn không có quyền thanh toán đặt chỗ này',
          );
        if (!is(reservation.status, 'Pending'))
          throw new AppError(
            409,
            'RESERVATION_NOT_PENDING',
            'Chỉ đơn đang chờ cọc mới tạo lại được liên kết thanh toán',
          );
        if (isHoldExpired(reservation.createdAt, new Date()))
          throw new AppError(
            410,
            'RESERVATION_HOLD_EXPIRED',
            'Đã hết 15 phút giữ chỗ. Vui lòng đặt lại',
          );
        const received = await tx.payment.findFirst({
          where: {
            reservationId: id,
            paymentType: 'Deposit',
            paymentStatus: 'Success',
          },
        });
        if (received)
          throw new AppError(
            409,
            'DEPOSIT_ALREADY_RECEIVED',
            'Đã nhận tiền cọc. Hãy kiểm tra trạng thái thay vì thanh toán lại',
          );
        let payment = await tx.payment.findFirst({
          where: {
            reservationId: id,
            paymentType: 'Deposit',
            paymentStatus: 'Pending',
          },
          orderBy: { paymentTime: 'desc' },
        });
        if (!payment) {
          const vehicle = await tx.vehicle.findUnique({
            where: { id: reservation.vehicleId },
            select: { vehicleTypeId: true },
          });
          const pricing = vehicle
            ? await this.activePolicy(vehicle.vehicleTypeId)
            : null;
          if (!pricing)
            throw new AppError(
              404,
              'PRICING_NOT_FOUND',
              'Không tìm thấy bảng giá',
            );
          payment = await tx.payment.create({
            data: {
              userId,
              reservationId: id,
              amount: pricing.basePrice,
              paymentMethod: 'PayOS',
              paymentStatus: 'Pending',
              paymentType: 'Deposit',
              paymentTime: new Date(),
            },
          });
        }
        return { reservation, payment };
      });
    } catch (error) {
      return PbmsResponseDto.fromError(error);
    }
    const { reservation, payment } = prepared;
    let link: Awaited<ReturnType<PayosService['createPaymentLink']>>;
    try {
      link = await this.payos.createPaymentLink(payment);
    } catch (error) {
      return PbmsResponseDto.fromError(error);
    }
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: { transactionReference: link.orderCode },
    });
    return PbmsResponseDto.ok('Tạo lại liên kết thanh toán thành công', {
      reservationId: id,
      paymentId: payment.id,
      depositAmount: toMoney(payment.amount),
      holdExpiresAt: holdExpiresAt(reservation.createdAt),
      paymentLinkId: link.paymentLinkId,
      paymentUrl: link.paymentUrl,
      orderCode: link.orderCode,
      ticket: await createTicket(id),
    });
  }

  /** Đổi giờ: chỉ chủ đơn, một lần, trước giờ hẹn cũ ít nhất 15 phút, còn suất ở giờ mới. */
  async changeTime(
    reservationId: string,
    userId: string,
    body: unknown,
  ): Promise<PbmsResponseDto> {
    const newExpected =
      pbmsPickDate(body, 'newExpectedTime', 'NewExpectedTime') ??
      (typeof body === 'string' || body instanceof Date
        ? pbmsPickDate(body)
        : undefined);
    if (!newExpected) return PbmsResponseDto.fail('Vui lòng chọn giờ hẹn mới');
    const reservation = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
    });
    if (!reservation)
      return PbmsResponseDto.fail('Không tìm thấy thông tin đặt chỗ', 404);
    if (reservation.userId !== userId) {
      return PbmsResponseDto.fail(
        'Bạn không có quyền đổi giờ đặt chỗ này',
        403,
      );
    }
    const now = new Date();
    const ruleError =
      changeTimeError(reservation.status, reservation.expectedEntryTime, now) ??
      entryTimeError(newExpected, now);
    if (ruleError) return PbmsResponseDto.fail(ruleError);

    const outcome = await this.prisma.$transaction(async (tx) => {
      await lockResource(tx, 'reservation:' + reservationId);
      if (reservation.parkingId) {
        await this.lockParking(tx, reservation.parkingId);
        const quota = await this.quotaError(
          tx,
          reservation.parkingId,
          newExpected,
          now,
          reservation.id,
        );
        if (quota) return quota;
      }
      const changed = await tx.reservation.updateMany({
        where: { id: reservationId, status: 'Confirmed' },
        data: { expectedEntryTime: newExpected, status: 'Modified' },
      });
      return changed.count === 1
        ? null
        : PbmsResponseDto.fail(
            'Đơn vừa thay đổi trạng thái, vui lòng tải lại',
            409,
          );
    });
    if (outcome) return outcome;
    const updated = await this.prisma.reservation.findUniqueOrThrow({
      where: { id: reservationId },
      include: reservationInclude,
    });
    return PbmsResponseDto.ok(
      'Đổi giờ đặt chỗ thành công',
      (await this.mapMany([updated]))[0],
    );
  }

  /**
   * Khách huỷ đơn.
   * - Đang chờ cọc: huỷ và đóng link PayOS để không trả nhầm.
   * - Đã cọc, huỷ trước giờ hẹn ít nhất 30 phút: hoàn 100% cọc vào ví. Muộn hơn: không hoàn.
   */
  async cancel(id: string, userId: string): Promise<PbmsResponseDto> {
    const item = await this.prisma.reservation.findUnique({
      where: { id },
      include: { vehicle: true },
    });
    if (!item)
      return PbmsResponseDto.fail('Không tìm thấy thông tin đặt chỗ', 404);
    if (item.userId !== userId)
      return PbmsResponseDto.fail('Bạn không có quyền huỷ đặt chỗ này', 403);
    if (is(item.status, 'CheckedIn') || is(item.status, 'Completed')) {
      return PbmsResponseDto.fail('Xe đã vào bãi, không huỷ được đặt chỗ');
    }
    const cancelled = await this.prisma.$transaction(async (tx) => {
      await lockResource(tx, 'reservation:' + id);
      return tx.reservation.updateMany({
        where: { id, userId, status: { in: [...OPEN_STATUSES] } },
        data: { status: 'Cancelled' },
      });
    });
    if (cancelled.count === 0)
      return PbmsResponseDto.fail('Đặt chỗ này đã kết thúc');
    await this.closePendingDeposits(id);

    const paid = await this.paidDeposit(id);
    const refund = !!paid && refundOnCancel(item.expectedEntryTime, new Date());
    const refunded = refund
      ? await this.refundDeposit(paid, item.vehicle.licensePlate)
      : null;
    return PbmsResponseDto.ok(
      refunded !== null
        ? `Đã huỷ đặt chỗ và hoàn ${formatVnd(refunded)} tiền cọc vào ví PBMS`
        : paid
          ? 'Đã huỷ đặt chỗ. Huỷ trong vòng 30 phút trước giờ hẹn nên tiền cọc không được hoàn'
          : 'Huỷ đặt chỗ thành công',
      { reservationId: id, status: 'Cancelled', refundedAmount: refunded ?? 0 },
    );
  }

  async checkPaymentStatus(orderCode: string): Promise<PbmsResponseDto> {
    const payment = await this.prisma.payment.findFirst({
      where: { transactionReference: orderCode },
    });
    if (!payment) return PbmsResponseDto.fail('Không tìm thấy thanh toán', 404);
    return PbmsResponseDto.ok('Lấy trạng thái thanh toán thành công', {
      paymentId: payment.id,
      reservationId: payment.reservationId,
      paymentStatus: payment.paymentStatus,
      ...paymentApplication(payment),
      amount: toMoney(payment.amount),
      orderCode: payment.transactionReference,
      ticket:
        payment.reservationId && paymentApplication(payment).isApplied
          ? await createTicket(payment.reservationId)
          : null,
    });
  }

  // ------------------------------------------------------- nhân viên / quản lý

  /** `date` là ngày theo giờ Việt Nam (YYYY-MM-DD). */
  async getAll(
    status?: string,
    date?: string,
    parkingId?: string,
  ): Promise<PbmsResponseDto> {
    const where: Prisma.ReservationWhereInput = {};
    if (status?.trim())
      where.status = { equals: status.trim(), mode: 'insensitive' };
    if (date?.trim()) {
      const day = vietnamDayRange(date);
      if (!day) return PbmsResponseDto.fail('Ngày phải theo dạng YYYY-MM-DD');
      where.expectedEntryTime = day;
    }
    if (parkingId?.trim()) where.parkingId = parkingId.trim();
    const items = await this.prisma.reservation.findMany({
      where,
      include: reservationInclude,
      orderBy: { expectedEntryTime: 'desc' },
    });
    return PbmsResponseDto.ok(
      'Lấy danh sách đặt chỗ thành công',
      await this.mapMany(items),
    );
  }

  /**
   * Nhân viên huỷ đơn (lỗi phía bãi: hoàn 100% cọc) hoặc đánh dấu khách không đến (sau giờ hẹn).
   * Vào bãi / hoàn tất do check-in / checkout ghi, không đặt tay.
   */
  async updateStatus(id: string, dto: object): Promise<PbmsResponseDto> {
    const status = pbmsPick(dto, 'status', 'Status').trim();
    if (!status) return PbmsResponseDto.fail('Vui lòng chọn trạng thái');
    const existing = await this.prisma.reservation.findUnique({
      where: { id },
      include: { vehicle: true },
    });
    if (!existing)
      return PbmsResponseDto.fail('Không tìm thấy thông tin đặt chỗ', 404);
    const ruleError = staffTransitionError(existing.status, status);
    if (ruleError) return PbmsResponseDto.fail(ruleError, 409);
    const next = is(status, 'NoShow') ? 'NoShow' : 'Cancelled';
    if (next === 'NoShow' && new Date() < existing.expectedEntryTime) {
      return PbmsResponseDto.fail('Chỉ đánh dấu không đến sau giờ hẹn', 409);
    }
    const changed = await this.prisma.reservation.updateMany({
      where: { id, status: existing.status },
      data: { status: next },
    });
    if (changed.count === 0)
      return PbmsResponseDto.fail(
        'Đơn vừa thay đổi trạng thái, vui lòng tải lại',
        409,
      );
    await this.closePendingDeposits(id);
    let refunded: number | null = null;
    if (next === 'Cancelled') {
      const paid = await this.paidDeposit(id);
      if (paid)
        refunded = await this.refundDeposit(
          paid,
          existing.vehicle.licensePlate,
        );
    }
    const updated = await this.prisma.reservation.findUniqueOrThrow({
      where: { id },
      include: reservationInclude,
    });
    await this.notifications?.notify(updated.userId, {
      title: 'Cập nhật đặt chỗ',
      message:
        `Đặt chỗ xe ${updated.vehicle.licensePlate} lúc ${formatTime(updated.expectedEntryTime)} ${STATUS_LABELS[next.toLowerCase()]}.` +
        (refunded
          ? ` Đã hoàn ${formatVnd(refunded)} tiền cọc vào ví PBMS.`
          : ''),
      type: 'reservation',
      metadata: { reservationId: id, status: next },
    });
    return PbmsResponseDto.ok(
      'Cập nhật trạng thái đặt chỗ thành công',
      (await this.mapMany([updated]))[0],
    );
  }

  // ------------------------------------------------------------ việc định kỳ

  /** Mỗi phút: huỷ đơn chờ cọc quá 15 phút, chuyển NoShow đơn đã cọc quá giờ hẹn 30 phút. */
  @Cron('* * * * *')
  async processOverdueReservations(): Promise<void> {
    const now = new Date();
    const stale = await this.prisma.reservation.findMany({
      where: {
        status: 'Pending',
        OR: [
          { createdAt: { lt: new Date(now.getTime() - HOLD_MS) } },
          { createdAt: null },
        ],
      },
      select: { id: true },
    });
    for (const item of stale) await this.expireHold(item.id);

    const overdue = await this.prisma.reservation.findMany({
      where: {
        status: { in: [...HELD_STATUSES] },
        expectedEntryTime: { lt: new Date(now.getTime() - ENTRY_WINDOW_MS) },
      },
      include: { vehicle: { select: { licensePlate: true } } },
    });
    let noShows = 0;
    for (const item of overdue) {
      const changed = await this.prisma.reservation.updateMany({
        where: { id: item.id, status: { in: [...HELD_STATUSES] } },
        data: { status: 'NoShow' },
      });
      if (changed.count === 0) continue;
      noShows++;
      await this.notifications?.notify(item.userId, {
        title: 'Đặt chỗ đã hết hiệu lực',
        message: `Xe ${item.vehicle.licensePlate} không vào bãi trong 30 phút sau giờ hẹn ${formatTime(item.expectedEntryTime)}, đặt chỗ đã hết hiệu lực và không hoàn cọc.`,
        type: 'reservation',
        metadata: { reservationId: item.id, status: 'NoShow' },
      });
    }
    if (stale.length || noShows) {
      this.logger.log(
        `Đặt chỗ: huỷ ${stale.length} đơn hết giờ giữ chỗ, ${noShows} đơn NoShow`,
      );
    }
  }

  /** Hết 15 phút giữ chỗ. Nếu tiền cọc thực ra đã về (webhook trễ) thì xác nhận thay vì huỷ. */
  private async expireHold(reservationId: string): Promise<void> {
    if (await this.paidDeposit(reservationId)) {
      await this.prisma.reservation.updateMany({
        where: { id: reservationId, status: 'Pending' },
        data: { status: 'Confirmed' },
      });
      return;
    }
    const changed = await this.prisma.reservation.updateMany({
      where: { id: reservationId, status: 'Pending' },
      data: { status: 'Cancelled' },
    });
    if (changed.count === 0) return;
    await this.closePendingDeposits(reservationId);
    const item = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
      select: {
        userId: true,
        expectedEntryTime: true,
        vehicle: { select: { licensePlate: true } },
      },
    });
    if (item) {
      await this.notifications?.notify(item.userId, {
        title: 'Hết thời gian giữ chỗ',
        message: `Đặt chỗ xe ${item.vehicle.licensePlate} lúc ${formatTime(item.expectedEntryTime)} chưa được trả cọc trong 15 phút nên đã huỷ.`,
        type: 'reservation',
        metadata: { reservationId, status: 'Cancelled' },
      });
    }
  }

  // ------------------------------------------------------------- hạn mức

  /**
   * Sức chứa vãng lai của một loại xe ở một bãi (bỏ trống = mọi bãi): cộng các tầng không phải cư dân.
   * Tầng có ô riêng thì đếm ô đúng loại; tầng dành riêng cho loại xe nhưng chưa sinh ô thì lấy sức chứa
   * khai báo của tầng. Gộp các loại xe trùng tên (vd. hai loại "Ô tô").
   */
  async walkInCapacity(
    vehicleTypeId: string,
    typeName: string,
    parkingId?: string | null,
  ): Promise<{ capacity: number; typeIds: string[] }> {
    const types = await this.prisma.vehicleType.findMany({
      select: { id: true, typeName: true },
    });
    const typeIds = [
      ...new Set([
        vehicleTypeId,
        ...types.filter((t) => is(t.typeName, typeName)).map((t) => t.id),
      ]),
    ];
    const floors = await this.prisma.floor.findMany({
      where: { isResident: false, ...(parkingId ? { parkingId } : {}) },
      select: {
        totalCapacity: true,
        dedicatedVehicleTypeId: true,
        _count: {
          select: {
            parkingSlots: { where: { vehicleTypeId: { in: typeIds } } },
          },
        },
      },
    });
    const capacity = floors.reduce((sum, f) => {
      if (f._count.parkingSlots > 0) return sum + f._count.parkingSlots;
      return f.dedicatedVehicleTypeId &&
        typeIds.includes(f.dedicatedVehicleTypeId)
        ? sum + Math.max(0, f.totalCapacity)
        : sum;
    }, 0);
    return { capacity, typeIds };
  }

  /** Khoá theo bãi trong transaction: hai người đặt cùng lúc không cùng lọt qua kiểm tra hạn mức. */
  private async lockParking(tx: Prisma.TransactionClient, parkingId: string) {
    await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${`reservation:${parkingId}`}))) AS l`;
  }

  /** Số suất đang bị giữ quanh giờ `at`: đơn đã cọc và đơn chờ cọc còn hạn, khung vào bãi chồng nhau. */
  private countHolds(
    db: Db,
    parkingId: string,
    at: Date,
    now: Date,
    excludeId: string | null,
  ) {
    return db.reservation.count({
      where: {
        parkingId,
        expectedEntryTime: overlapRange(at),
        ...(excludeId ? { NOT: { id: excludeId } } : {}),
        OR: [
          { status: { in: [...HELD_STATUSES] } },
          {
            status: 'Pending',
            createdAt: { gte: new Date(now.getTime() - HOLD_MS) },
          },
        ],
      },
    });
  }

  private async quotaError(
    db: Db,
    parkingId: string,
    at: Date,
    now: Date,
    excludeId: string | null,
  ): Promise<PbmsResponseDto | null> {
    const carType = await db.vehicleType.findFirst({
      where: { typeName: { equals: CAR, mode: 'insensitive' } },
      select: { id: true },
    });
    const capacity = carType
      ? (await this.walkInCapacity(carType.id, CAR, parkingId)).capacity
      : 0;
    const quota = quotaOf(capacity);
    if (quota === 0) {
      return PbmsResponseDto.fail(
        'Bãi này chưa mở chỗ ô tô cho khách vãng lai nên chưa nhận đặt trước',
      );
    }
    const used = await this.countHolds(db, parkingId, at, now, excludeId);
    if (used >= quota) {
      return PbmsResponseDto.fail(
        `Bãi đã hết suất đặt trước quanh ${formatTime(at)}. Chọn giờ khác, bãi khác hoặc vào trực tiếp.`,
        409,
      );
    }
    return null;
  }

  // ------------------------------------------------------------ tiền cọc

  private paidDeposit(reservationId: string) {
    return this.prisma.payment.findFirst({
      where: {
        reservationId,
        paymentType: 'Deposit',
        paymentStatus: 'Success',
      },
      orderBy: { paymentTime: 'desc' },
    });
  }

  /**
   * Hoàn tiền cọc vào ví và đánh dấu thanh toán Refunded.
   * Trả số tiền đã hoàn (0 nếu đã hoàn trước đó), null nếu không hoàn được.
   */
  async refundDeposit(
    payment: { id: string; userId: string | null; amount: Prisma.Decimal },
    licensePlate: string,
  ): Promise<number | null> {
    if (!this.wallets || !payment.userId) return null;
    const wallets = this.wallets;
    const credited = await this.prisma.$transaction(async (tx) => {
      const done = await wallets.creditRefund(
        tx,
        payment,
        'Deposit',
        `Hoàn cọc đặt chỗ xe ${licensePlate}`,
      );
      await tx.payment.update({
        where: { id: payment.id },
        data: { paymentStatus: 'Refunded' },
      });
      return done;
    });
    const amount = toMoney(payment.amount);
    if (credited) {
      await this.notifications?.notify(payment.userId, {
        title: 'Đã hoàn tiền cọc',
        message: `Đã hoàn ${formatVnd(amount)} tiền cọc đặt chỗ xe ${licensePlate} vào ví PBMS.`,
        type: 'wallet',
        metadata: { paymentId: payment.id },
      });
    }
    return amount;
  }

  /** Đóng link PayOS cọc đang chờ của một đơn và đánh dấu Failed. */
  private async closePendingDeposits(reservationId: string): Promise<void> {
    const pending = await this.prisma.payment.findMany({
      where: {
        reservationId,
        paymentType: 'Deposit',
        paymentStatus: 'Pending',
      },
    });
    for (const p of pending) {
      const orderCode = p.transactionReference?.trim();
      if (orderCode)
        await this.payos.cancelPaymentLink(orderCode).catch(() => undefined);
      await this.prisma.payment.updateMany({
        where: { id: p.id, paymentStatus: 'Pending' },
        data: { paymentStatus: 'Failed' },
      });
    }
  }

  // ------------------------------------------------------------- hỗ trợ

  /** Bãi khách chọn; app cũ chưa gửi bãi thì dùng bãi duy nhất nếu hệ thống chỉ có một bãi. */
  private async resolveParking(
    parkingId: string,
  ): Promise<{ id: string; name: string } | { error: PbmsResponseDto }> {
    if (!isEmptyGuid(parkingId)) {
      const parking = await this.prisma.parking.findUnique({
        where: { id: parkingId },
        select: { id: true, name: true },
      });
      return (
        parking ?? { error: PbmsResponseDto.fail('Không tìm thấy bãi đỗ', 404) }
      );
    }
    const parkings = await this.prisma.parking.findMany({
      select: { id: true, name: true },
      take: 2,
    });
    return parkings.length === 1
      ? parkings[0]
      : { error: PbmsResponseDto.fail('Vui lòng chọn bãi đỗ') };
  }

  private canManage(role: string): boolean {
    const value = role.trim().toLowerCase();
    return value === 'manager' || value === 'staff' || value === 'admin';
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

  private async mapMany(items: ReservationRow[]) {
    const deposits = items.length
      ? await this.prisma.payment.findMany({
          where: {
            reservationId: { in: items.map((i) => i.id) },
            paymentType: 'Deposit',
          },
          orderBy: { paymentTime: 'desc' },
          select: { reservationId: true, amount: true, paymentStatus: true },
        })
      : [];
    const now = new Date();
    return Promise.all(
      items.map(async (item) => {
        const deposit = deposits.find((d) => d.reservationId === item.id);
        const window = entryWindow(item.expectedEntryTime);
        const held = isHeld(item.status);
        const pending = is(item.status, 'Pending');
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
          parkingId: item.parkingId,
          parkingName: item.parking?.name ?? null,
          expectedEntryTime: item.expectedEntryTime,
          status: item.status,
          createdAt: item.createdAt,
          depositAmount: deposit ? toMoney(deposit.amount) : null,
          depositStatus: deposit?.paymentStatus ?? null,
          /** Đơn chờ cọc: hạn trả cọc. */
          holdExpiresAt: pending ? holdExpiresAt(item.createdAt) : null,
          checkInFrom: window.from,
          checkInUntil: window.until,
          canChangeTime:
            changeTimeError(item.status, item.expectedEntryTime, now) === null,
          canCancel: pending || held,
          /** Huỷ trước mốc này thì được hoàn 100% cọc. */
          refundDeadline: new Date(
            item.expectedEntryTime.getTime() - REFUND_MIN_BEFORE_MS,
          ),
          refundIfCancelNow:
            held && refundOnCancel(item.expectedEntryTime, now),
          ticket: await createTicket(item.id),
        };
      }),
    );
  }
}
