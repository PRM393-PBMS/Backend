import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import jsQR from 'jsqr';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';
import { PayosService } from '../integrations/payos-files.service';
import { PlateRecognizerService } from '../integrations/plate-recognizer.service';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import {
  errorMessage,
  isEmptyGuid,
  pbmsPick,
  pbmsPickGuid,
  sameStatus,
  toMoney,
} from '../common/pbms-fields';
import { isValidLicensePlate, normalizeLicensePlate } from '../common/license-plate';
import { createTicket, extractGuidFromQrPayload } from '../common/qr.util';
import { ParkingSessionsService } from './parking-sessions.service';

@Injectable()
export class ParkingOperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payos: PayosService,
    private readonly plates: PlateRecognizerService,
    private readonly sessions: ParkingSessionsService,
  ) {}

  async checkIn(dto: object): Promise<PbmsResponseDto> {
    const customerType = this.normalizeCustomer(pbmsPick(dto, 'customerType', 'CustomerType'));
    if (!customerType) {
      return PbmsResponseDto.fail('Vui lòng chọn CustomerType: Guest, Resident hoặc Reservation');
    }
    const gateId = pbmsPickGuid(dto, 'gateId', 'GateId');
    const gate = await this.resolveGate(gateId, 'Entry');
    if ('error' in gate) {
      return gate.error ?? PbmsResponseDto.fail('Cổng không hợp lệ');
    }
    if (customerType === 'Reservation') {
      return this.checkInReservation(dto, gate.gate);
    }
    if (customerType === 'Resident') {
      return this.checkInResident(dto, gate.gate);
    }
    return this.checkInGuest(dto, gate.gate);
  }

  async checkOut(dto: object): Promise<PbmsResponseDto> {
    const gateId = pbmsPickGuid(dto, 'gateId', 'GateId');
    const gate = await this.resolveGate(gateId, 'Exit');
    if ('error' in gate) {
      return gate.error ?? PbmsResponseDto.fail('Cổng không hợp lệ');
    }
    const sessionId = await this.resolveSessionId(dto);
    if (sessionId instanceof PbmsResponseDto) {
      return sessionId;
    }
    const session = await this.prisma.parkingSession.findUnique({
      where: { id: sessionId },
      include: { vehicleType: true },
    });
    if (!session || !sameStatus(session.status, 'Active')) {
      return PbmsResponseDto.fail('Không tìm thấy phiên gửi xe đang hoạt động', 404);
    }
    const exitTime = new Date();
    const plateOut =
      normalizeLicensePlate(pbmsPick(dto, 'licensePlateOut', 'LicensePlateOut')) || session.licensePlateIn;
    await this.prisma.parkingSession.update({
      where: { id: session.id },
      data: {
        exitGateId: gate.gate.id,
        exitTime,
        licensePlateOut: plateOut,
        exitImageUrl: pbmsPick(dto, 'exitImageUrl', 'ExitImageUrl').trim() || null,
        driverExitImageUrl: pbmsPick(dto, 'driverExitImageUrl', 'DriverExitImageUrl').trim() || null,
      },
    });

    const subscription = await this.activeSubscription(session.licensePlateIn, session.vehicleTypeId, exitTime);
    if (!session.reservationId && subscription) {
      await this.closeSession(session.id, subscription.fixedSlotId);
      const mapped = await this.loadSession(session.id);
      return PbmsResponseDto.ok('Checkout thành công (đã bao gồm trong gói tháng)', mapped);
    }

    const fee = await this.calculateFee(session, exitTime);
    if (fee instanceof PbmsResponseDto) {
      return fee;
    }
    if (fee.amount <= 0) {
      await this.closeSession(session.id, subscription?.fixedSlotId ?? null);
      return PbmsResponseDto.ok('Checkout thành công', {
        Session: await this.loadSession(session.id),
        Fee: fee,
      });
    }

    const method = this.normalizeMethod(pbmsPick(dto, 'paymentMethod', 'PaymentMethod')) || 'Cash';
    const payment = await this.prisma.payment.create({
      data: {
        userId: session.driverUserId,
        sessionId: session.id,
        reservationId: session.reservationId,
        amount: new Prisma.Decimal(fee.amount),
        paymentMethod: method,
        paymentType: 'CheckoutFee',
        paymentTime: exitTime,
        paymentStatus: 'Pending',
        transactionReference: '',
      },
    });

    if (method === 'PayOS') {
      try {
        const link = await this.payos.createPaymentLink(payment);
        await this.prisma.payment.update({
          where: { id: payment.id },
          data: { transactionReference: link.orderCode },
        });
        return PbmsResponseDto.ok('Đã tạo yêu cầu thanh toán checkout', {
          Payment: this.mapPayment(payment, link.orderCode),
          OnlinePayment: {
            paymentUrl: link.paymentUrl,
            paymentLinkId: link.paymentLinkId,
            orderCode: link.orderCode,
          },
          Fee: fee,
        });
      } catch (error: unknown) {
        return PbmsResponseDto.fail(`Không thể tạo liên kết thanh toán: ${errorMessage(error)}`, 502);
      }
    }

    return PbmsResponseDto.ok('Chờ xác nhận tiền mặt để hoàn tất checkout', {
      Payment: this.mapPayment(payment),
      Fee: fee,
    });
  }

  async getFeePreview(sessionId: string): Promise<PbmsResponseDto> {
    const session = await this.prisma.parkingSession.findUnique({ where: { id: sessionId } });
    if (!session || !sameStatus(session.status, 'Active')) {
      return PbmsResponseDto.fail('Không tìm thấy phiên gửi xe đang hoạt động', 404);
    }
    const pending = await this.prisma.payment.findFirst({
      where: { sessionId, paymentType: 'CheckoutFee', paymentStatus: 'Pending' },
    });
    const calculatedAt = pending?.paymentTime ?? new Date();
    const subscription = await this.activeSubscription(session.licensePlateIn, session.vehicleTypeId, calculatedAt);
    const totalHours = Math.max(0, (calculatedAt.getTime() - session.entryTime.getTime()) / 36e5);
    const billedHours = Math.max(1, Math.ceil(totalHours));
    if (!session.reservationId && subscription) {
      return PbmsResponseDto.ok('Phí gửi xe đã được bao gồm trong gói tháng', {
        sessionId: session.id,
        licensePlate: session.licensePlateIn,
        entryTime: session.entryTime,
        exitTime: calculatedAt,
        totalHours: Math.round(totalHours * 100) / 100,
        billedHours,
        amount: 0,
        isCoveredBySubscription: true,
      });
    }
    const fee = await this.calculateFee(session, calculatedAt);
    if (fee instanceof PbmsResponseDto) {
      return fee;
    }
    return PbmsResponseDto.ok('Tính phí gửi xe tạm tính thành công', fee);
  }

  async getMyFeePreview(sessionId: string, userId: string): Promise<PbmsResponseDto> {
    const owner = await this.assertOwner(sessionId, userId);
    return owner ?? this.getFeePreview(sessionId);
  }

  async getMyCheckoutPayment(sessionId: string, userId: string): Promise<PbmsResponseDto> {
    const owner = await this.assertOwner(sessionId, userId);
    if (owner) {
      return owner;
    }
    const payment = await this.prisma.payment.findFirst({
      where: { sessionId, paymentType: 'CheckoutFee', paymentStatus: 'Pending' },
      orderBy: { paymentTime: 'desc' },
    });
    if (!payment) {
      return PbmsResponseDto.ok('Chưa có yêu cầu thanh toán checkout', {
        Payment: null,
        OnlinePayment: null,
      });
    }
    let onlinePayment: object | null = null;
    if (sameStatus(payment.paymentMethod, 'PayOS') && payment.transactionReference) {
      try {
        const link = await this.payos.getPaymentLink(payment.transactionReference);
        onlinePayment = {
          paymentUrl: link.paymentUrl,
          paymentLinkId: link.paymentLinkId,
          orderCode: payment.transactionReference,
        };
      } catch (error: unknown) {
        return PbmsResponseDto.fail(`Không thể tải liên kết thanh toán: ${errorMessage(error)}`, 502);
      }
    }
    return PbmsResponseDto.ok('Lấy yêu cầu thanh toán checkout thành công', {
      Payment: this.mapPayment(payment),
      OnlinePayment: onlinePayment,
    });
  }

  async getCheckoutPayment(paymentId: string): Promise<PbmsResponseDto> {
    const payment = await this.findCheckoutPayment(paymentId);
    if (payment instanceof PbmsResponseDto) {
      return payment;
    }
    return PbmsResponseDto.ok('Lấy trạng thái thanh toán checkout thành công', {
      Payment: this.mapPayment(payment),
      Session: payment.sessionId ? await this.loadSession(payment.sessionId) : null,
    });
  }

  async confirmCash(paymentId: string): Promise<PbmsResponseDto> {
    const payment = await this.findCheckoutPayment(paymentId);
    if (payment instanceof PbmsResponseDto) {
      return payment;
    }
    if (!sameStatus(payment.paymentMethod, 'Cash')) {
      return PbmsResponseDto.fail('Chỉ thanh toán tiền mặt mới được nhân viên xác nhận thủ công');
    }
    if (sameStatus(payment.paymentStatus, 'Success')) {
      return PbmsResponseDto.ok('Thanh toán đã được xác nhận trước đó', {
        Payment: this.mapPayment(payment),
        Session: payment.sessionId ? await this.loadSession(payment.sessionId) : null,
      });
    }
    if (!sameStatus(payment.paymentStatus, 'Pending')) {
      return PbmsResponseDto.fail('Thanh toán đã bị hủy hoặc thất bại, không thể xác nhận', 409);
    }
    const session = await this.prisma.parkingSession.findUnique({ where: { id: payment.sessionId! } });
    if (!session?.exitGateId || !session.exitTime) {
      return PbmsResponseDto.fail('Yêu cầu checkout chưa có đủ thông tin cổng ra và thời gian ra', 409);
    }
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: { paymentStatus: 'Success', paymentTime: new Date() },
    });
    await this.closeSession(session.id, null);
    return PbmsResponseDto.ok('Đã nhận tiền mặt và checkout thành công', {
      Payment: this.mapPayment({ ...payment, paymentStatus: 'Success' }),
      Session: await this.loadSession(session.id),
    });
  }

  async cancelCheckout(paymentId: string): Promise<PbmsResponseDto> {
    const payment = await this.findCheckoutPayment(paymentId);
    if (payment instanceof PbmsResponseDto) {
      return payment;
    }
    if (sameStatus(payment.paymentStatus, 'Success')) {
      return PbmsResponseDto.fail('Thanh toán đã thành công nên không thể hủy checkout', 409);
    }
    if (sameStatus(payment.paymentStatus, 'Failed')) {
      return PbmsResponseDto.ok('Yêu cầu checkout đã được hủy trước đó', { Payment: this.mapPayment(payment) });
    }
    if (sameStatus(payment.paymentMethod, 'PayOS') && payment.transactionReference) {
      try {
        await this.payos.cancelPaymentLink(payment.transactionReference);
      } catch (error: unknown) {
        return PbmsResponseDto.fail(`Không thể hủy liên kết thanh toán: ${errorMessage(error)}`, 502);
      }
    }
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: { paymentStatus: 'Failed' },
    });
    if (payment.sessionId) {
      await this.prisma.parkingSession.update({
        where: { id: payment.sessionId },
        data: {
          exitGateId: null,
          exitTime: null,
          licensePlateOut: null,
          exitImageUrl: null,
          driverExitImageUrl: null,
        },
      });
    }
    return PbmsResponseDto.ok('Đã hủy yêu cầu checkout', {
      Payment: this.mapPayment({ ...payment, paymentStatus: 'Failed' }),
    });
  }

  async recognizePlate(file: import('../common/uploaded-image').UploadedImage, imageUrl: string | null) {
    const result = await this.plates.recognize(file, imageUrl);
    return result;
  }

  async decodeQr(file: import('../common/uploaded-image').UploadedImage, imageUrl: string | null): Promise<PbmsResponseDto> {
    const payload = await this.decodeQrBuffer(file.buffer);
    if (!payload) {
      return PbmsResponseDto.fail('Không tìm thấy mã QR trong ảnh', 422);
    }
    const resolved = await this.resolveQr(payload);
    if (resolved instanceof PbmsResponseDto) {
      return resolved;
    }
    return PbmsResponseDto.ok('Giải mã QR thành công', {
      qrPayload: payload.trim(),
      codeType: resolved.codeType,
      reservationId: resolved.reservationId,
      sessionId: resolved.sessionId,
      imageUrl,
    });
  }

  async resolveQrPayload(dto: object): Promise<PbmsResponseDto> {
    const payload = pbmsPick(dto, 'qrPayload', 'QrPayload');
    if (!payload.trim()) {
      return PbmsResponseDto.fail('Vui lòng gửi QrPayload');
    }
    const resolved = await this.resolveQr(payload);
    if (resolved instanceof PbmsResponseDto) {
      return resolved;
    }
    return PbmsResponseDto.ok('Giải mã payload QR thành công', {
      qrPayload: payload.trim(),
      codeType: resolved.codeType,
      reservationId: resolved.reservationId,
      sessionId: resolved.sessionId,
    });
  }

  async availability(vehicleTypeId?: string, floorKeyword?: string): Promise<PbmsResponseDto> {
    const slots = await this.prisma.parkingSlot.findMany({
      where: {
        ...(vehicleTypeId ? { vehicleTypeId } : {}),
        ...(floorKeyword
          ? { floor: { floorName: { contains: floorKeyword.trim(), mode: 'insensitive' } } }
          : {}),
      },
      include: { floor: true, vehicleType: true },
    });
    const grouped = new Map<
      string,
      {
        floorId: string;
        floorName: string;
        vehicleTypeId: string;
        vehicleTypeName: string;
        totalSlots: number;
        availableSlots: number;
        occupiedSlots: number;
        assignedSlots: number;
      }
    >();
    for (const slot of slots) {
      const key = `${slot.floorId}:${slot.vehicleTypeId}`;
      const current = grouped.get(key) ?? {
        floorId: slot.floorId,
        floorName: slot.floor.floorName,
        vehicleTypeId: slot.vehicleTypeId,
        vehicleTypeName: slot.vehicleType.typeName,
        totalSlots: 0,
        availableSlots: 0,
        occupiedSlots: 0,
        assignedSlots: 0,
      };
      current.totalSlots += 1;
      if (sameStatus(slot.status, 'Available')) current.availableSlots += 1;
      if (sameStatus(slot.status, 'Occupied')) current.occupiedSlots += 1;
      if (sameStatus(slot.status, 'Assigned')) current.assignedSlots += 1;
      grouped.set(key, current);
    }
    return PbmsResponseDto.ok(
      'Lấy tình trạng chỗ trống thành công',
      [...grouped.values()].sort((a, b) => a.floorName.localeCompare(b.floorName)),
    );
  }

  private async checkInGuest(
    dto: object,
    gate: { id: string; floorId: string },
  ): Promise<PbmsResponseDto> {
    const plate = normalizeLicensePlate(pbmsPick(dto, 'licensePlate', 'LicensePlate'));
    const vehicleTypeId = pbmsPickGuid(dto, 'vehicleTypeId', 'VehicleTypeId');
    if (!isValidLicensePlate(plate)) {
      return PbmsResponseDto.fail('Biển số phải gồm 4-15 chữ cái và chữ số');
    }
    if (isEmptyGuid(vehicleTypeId)) {
      return PbmsResponseDto.fail('Vui lòng chọn loại phương tiện');
    }
    const sub = await this.activeSubscription(plate, vehicleTypeId, new Date());
    if (sub) {
      return PbmsResponseDto.fail('Biển số này đang có gói tháng hợp lệ. Vui lòng check-in Resident', 403);
    }
    const busy = await this.prisma.parkingSession.findFirst({
      where: { licensePlateIn: plate, status: 'Active' },
    });
    if (busy) {
      return PbmsResponseDto.fail('Xe này đang có phiên gửi xe chưa checkout', 409);
    }
    const slot = await this.findGuestSlot(vehicleTypeId, gate.floorId);
    if (!slot) {
      return PbmsResponseDto.fail('Hệ thống hết vị trí trống khả dụng cho xe vãng lai', 409);
    }
    const session = await this.createActiveSession({
      licensePlate: plate,
      vehicleTypeId,
      gateId: gate.id,
      slotId: slot.id,
      dto,
    });
    await this.prisma.parkingSlot.update({ where: { id: slot.id }, data: { status: 'Occupied' } });
    return PbmsResponseDto.ok('Check-in xe vãng lai thành công', await this.loadSession(session.id), 201);
  }

  private async checkInResident(
    dto: object,
    gate: { id: string; floorId: string },
  ): Promise<PbmsResponseDto> {
    const plate = normalizeLicensePlate(pbmsPick(dto, 'licensePlate', 'LicensePlate'));
    if (!isValidLicensePlate(plate)) {
      return PbmsResponseDto.fail('Biển số phải gồm 4-15 chữ cái và chữ số');
    }
    const sub = await this.prisma.monthlySubscription.findFirst({
      where: {
        licensePlate: plate,
        status: 'Active',
        startDate: { lte: new Date() },
        endDate: { gte: new Date() },
      },
      include: { vehicleType: true },
    });
    if (!sub) {
      return PbmsResponseDto.fail('Không tìm thấy gói tháng hiệu lực cho biển số này', 404);
    }
    const busy = await this.prisma.parkingSession.findFirst({
      where: { licensePlateIn: plate, status: 'Active' },
    });
    if (busy) {
      return PbmsResponseDto.fail('Xe này đang có phiên gửi xe chưa checkout', 409);
    }
    const slotId = sub.fixedSlotId;
    if (slotId) {
      await this.prisma.parkingSlot.update({ where: { id: slotId }, data: { status: 'Occupied' } });
    }
    const session = await this.createActiveSession({
      licensePlate: plate,
      vehicleTypeId: sub.vehicleTypeId,
      gateId: gate.id,
      slotId,
      dto,
      driverUserId: sub.userId,
    });
    void gate;
    return PbmsResponseDto.ok('Check-in khách tháng thành công', await this.loadSession(session.id), 201);
  }

  private async checkInReservation(
    dto: object,
    gate: { id: string; floorId: string },
  ): Promise<PbmsResponseDto> {
    const reservationId =
      pbmsPickGuid(dto, 'reservationId', 'ReservationId') ||
      extractGuidFromQrPayload(pbmsPick(dto, 'qrPayload', 'QrPayload')) ||
      '';
    const plate = normalizeLicensePlate(pbmsPick(dto, 'licensePlate', 'LicensePlate'));
    if (isEmptyGuid(reservationId)) {
      return PbmsResponseDto.fail('Vui lòng quét mã đặt chỗ hoặc gửi QrPayload');
    }
    if (!isValidLicensePlate(plate)) {
      return PbmsResponseDto.fail('Vui lòng nhập biển số');
    }
    const reservation = await this.prisma.reservation.findUnique({ where: { id: reservationId } });
    if (!reservation) {
      return PbmsResponseDto.fail('Không tìm thấy đặt chỗ', 404);
    }
    if (!sameStatus(reservation.status, 'Confirmed') && !sameStatus(reservation.status, 'Modified')) {
      return PbmsResponseDto.fail('Đặt chỗ phải ở trạng thái Confirmed hoặc Modified để check-in');
    }
    const now = new Date();
    const min = new Date(reservation.expectedEntryTime.getTime() - 30 * 60 * 1000);
    const max = new Date(reservation.expectedEntryTime.getTime() + 30 * 60 * 1000);
    if (now < min || now > max) {
      return PbmsResponseDto.fail(
        'Ngoài khung giờ cho phép check-in đặt trước (Chỉ áp dụng trong khoảng -30p đến +30p so với giờ hẹn)',
      );
    }
    const sub = await this.activeSubscription(plate, reservation.vehicleTypeId, now);
    if (sub) {
      return PbmsResponseDto.fail(
        'Biển số này đang có gói tháng hợp lệ. Không thể check-in bằng vé đặt trước; vui lòng check-in tại tầng cư dân / khách tháng',
        403,
      );
    }
    const busy = await this.prisma.parkingSession.findFirst({
      where: { licensePlateIn: plate, status: 'Active' },
    });
    if (busy) {
      return PbmsResponseDto.fail('Xe này đang có phiên gửi xe chưa checkout', 409);
    }
    const slot = await this.findReservationSlot(reservation.vehicleTypeId, gate.floorId);
    if (!slot) {
      return PbmsResponseDto.fail('Hệ thống hết vị trí trống khả dụng cho xe đặt trước tại thời điểm này', 409);
    }
    const session = await this.prisma.$transaction(async (tx) => {
      const created = await tx.parkingSession.create({
        data: {
          reservationId: reservation.id,
          driverUserId: reservation.userId,
          licensePlateIn: plate,
          entryImageUrl: pbmsPick(dto, 'entryImageUrl', 'EntryImageUrl').trim() || null,
          driverEntryImageUrl: pbmsPick(dto, 'driverEntryImageUrl', 'DriverEntryImageUrl').trim() || null,
          vehicleTypeId: reservation.vehicleTypeId,
          entryTime: now,
          entryGateId: gate.id,
          assignedSlotId: slot.id,
          actualSlotId: slot.id,
          status: 'Active',
        },
      });
      await tx.reservation.update({ where: { id: reservation.id }, data: { status: 'CheckedIn' } });
      await tx.parkingSlot.update({ where: { id: slot.id }, data: { status: 'Occupied' } });
      return created;
    });
    return PbmsResponseDto.ok('Check-in xe đặt trước thành công', await this.loadSession(session.id), 201);
  }

  private async createActiveSession(input: {
    licensePlate: string;
    vehicleTypeId: string;
    gateId: string;
    slotId: string | null;
    dto: object;
    driverUserId?: string | null;
  }) {
    return this.prisma.parkingSession.create({
      data: {
        driverUserId: input.driverUserId ?? null,
        licensePlateIn: input.licensePlate,
        entryImageUrl: pbmsPick(input.dto, 'entryImageUrl', 'EntryImageUrl').trim() || null,
        driverEntryImageUrl: pbmsPick(input.dto, 'driverEntryImageUrl', 'DriverEntryImageUrl').trim() || null,
        vehicleTypeId: input.vehicleTypeId,
        entryTime: new Date(),
        entryGateId: input.gateId,
        assignedSlotId: input.slotId,
        actualSlotId: input.slotId,
        status: 'Active',
      },
    });
  }

  private async findGuestSlot(vehicleTypeId: string, floorId: string) {
    const preferred = await this.prisma.parkingSlot.findFirst({
      where: { vehicleTypeId, floorId, status: 'Available', floor: { isResident: false } },
    });
    if (preferred) {
      return preferred;
    }
    return this.prisma.parkingSlot.findFirst({
      where: { vehicleTypeId, status: 'Available', floor: { isResident: false } },
    });
  }

  private findReservationSlot(vehicleTypeId: string, floorId: string) {
    return this.findGuestSlot(vehicleTypeId, floorId);
  }

  private async closeSession(sessionId: string, assignedFixedSlotId: string | null): Promise<void> {
    const session = await this.prisma.parkingSession.findUnique({ where: { id: sessionId } });
    if (!session) {
      return;
    }
    await this.prisma.parkingSession.update({
      where: { id: sessionId },
      data: { status: 'Completed' },
    });
    if (session.actualSlotId) {
      await this.prisma.parkingSlot.update({
        where: { id: session.actualSlotId },
        data: { status: assignedFixedSlotId === session.actualSlotId ? 'Assigned' : 'Available' },
      });
    }
    if (session.reservationId) {
      await this.prisma.reservation.update({
        where: { id: session.reservationId },
        data: { status: 'Completed' },
      });
    }
  }

  private async calculateFee(session: { id: string; licensePlateIn: string; vehicleTypeId: string; entryTime: Date; reservationId: string | null }, exitTime: Date) {
    const policy = await this.prisma.pricingPolicy.findFirst({
      where: {
        vehicleTypeId: session.vehicleTypeId,
        status: 'Active',
        effectiveDate: { lte: exitTime },
      },
      orderBy: { effectiveDate: 'desc' },
    });
    if (!policy) {
      return PbmsResponseDto.fail('Chưa cấu hình chính sách giá active cho loại phương tiện này');
    }
    const totalHours = Math.max(0, (exitTime.getTime() - session.entryTime.getTime()) / 36e5);
    const billedHours = Math.max(1, Math.ceil(totalHours));
    let amount = Number(policy.basePrice);
    const nightSurchargeCount =
      Number(policy.nightSurcharge) > 0 ? this.countNightSurcharges(session.entryTime, exitTime) : 0;
    if (billedHours > policy.baseHours) {
      amount += (billedHours - policy.baseHours) * Number(policy.extraHourPrice);
    }
    if (nightSurchargeCount > 0) {
      amount += nightSurchargeCount * Number(policy.nightSurcharge);
    }
    const grossAmount = amount;
    let depositAmount = 0;
    if (session.reservationId) {
      const deposits = await this.prisma.payment.aggregate({
        where: {
          reservationId: session.reservationId,
          paymentType: 'Deposit',
          paymentStatus: 'Success',
        },
        _sum: { amount: true },
      });
      depositAmount = Math.min(grossAmount, Number(deposits._sum.amount ?? 0));
      amount = Math.max(0, grossAmount - depositAmount);
    }
    return {
      sessionId: session.id,
      licensePlate: session.licensePlateIn,
      entryTime: session.entryTime,
      exitTime,
      totalHours: Math.round(totalHours * 100) / 100,
      billedHours,
      grossAmount,
      depositAmount,
      amount,
      pricingPolicyId: policy.id,
      basePrice: Number(policy.basePrice),
      baseHours: policy.baseHours,
      extraHourPrice: Number(policy.extraHourPrice),
      nightSurcharge: Number(policy.nightSurcharge),
      nightSurchargeCount,
      hasNightSurcharge: nightSurchargeCount > 0,
      isCoveredBySubscription: false,
    };
  }

  private countNightSurcharges(entryTime: Date, exitTime: Date): number {
    if (exitTime <= entryTime) {
      return 0;
    }
    let nightCount = 0;
    for (let utcDate = new Date(Date.UTC(entryTime.getUTCFullYear(), entryTime.getUTCMonth(), entryTime.getUTCDate())); utcDate <= exitTime; utcDate = new Date(utcDate.getTime() + 86400000)) {
      const nightStartUtc = new Date(utcDate.getTime() + 15 * 3600000);
      const nightEndUtc = new Date(utcDate.getTime() + 23 * 3600000);
      if (entryTime < nightEndUtc && exitTime > nightStartUtc) {
        nightCount += 1;
      }
    }
    return nightCount;
  }

  private async resolveGate(gateId: string, type: 'Entry' | 'Exit') {
    if (isEmptyGuid(gateId)) {
      return { error: PbmsResponseDto.fail('Vui lòng chọn cổng') };
    }
    const gate = await this.prisma.gate.findUnique({ where: { id: gateId }, include: { floor: true } });
    if (!gate) {
      return { error: PbmsResponseDto.fail('Không tìm thấy cổng', 404) };
    }
    if (!sameStatus(gate.gateType, type)) {
      return { error: PbmsResponseDto.fail(`Cổng phải là loại ${type}`) };
    }
    return { gate };
  }

  private async resolveSessionId(dto: object): Promise<string | PbmsResponseDto> {
    const direct = pbmsPickGuid(dto, 'sessionId', 'SessionId');
    if (direct) {
      return direct;
    }
    const fromQr = extractGuidFromQrPayload(pbmsPick(dto, 'qrPayload', 'QrPayload'));
    if (fromQr) {
      return fromQr;
    }
    const plate = normalizeLicensePlate(pbmsPick(dto, 'licensePlate', 'LicensePlate'));
    if (plate) {
      const session = await this.prisma.parkingSession.findFirst({
        where: { licensePlateIn: plate, status: 'Active' },
        orderBy: { entryTime: 'desc' },
      });
      if (session) {
        return session.id;
      }
    }
    return PbmsResponseDto.fail('Vui lòng quét mã vé gửi xe hoặc gửi QrPayload');
  }

  private async resolveQr(payload: string) {
    const id = extractGuidFromQrPayload(payload);
    if (!id) {
      return PbmsResponseDto.fail('Mã QR không chứa GUID hợp lệ');
    }
    const reservationExists = !!(await this.prisma.reservation.findUnique({ where: { id } }));
    const sessionExists = !!(await this.prisma.parkingSession.findUnique({ where: { id } }));
    if (!reservationExists && !sessionExists) {
      return PbmsResponseDto.fail('Mã QR không khớp mã đặt chỗ hoặc vé gửi xe', 404);
    }
    const codeType =
      reservationExists && sessionExists ? 'SessionAndReservation' : sessionExists ? 'Session' : 'Reservation';
    return {
      reservationId: reservationExists ? id : null,
      sessionId: sessionExists ? id : null,
      codeType,
    };
  }

  private async decodeQrBuffer(buffer: Buffer): Promise<string | null> {
    const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const code = jsQR(new Uint8ClampedArray(data), info.width, info.height);
    return code?.data ?? null;
  }

  private async activeSubscription(plate: string, vehicleTypeId: string, at: Date) {
    return this.prisma.monthlySubscription.findFirst({
      where: {
        licensePlate: plate,
        vehicleTypeId,
        status: 'Active',
        startDate: { lte: at },
        endDate: { gte: at },
      },
    });
  }

  private async assertOwner(sessionId: string, userId: string) {
    if (isEmptyGuid(sessionId) || isEmptyGuid(userId)) {
      return PbmsResponseDto.fail('Thông tin phiên gửi xe không hợp lệ');
    }
    const session = await this.prisma.parkingSession.findUnique({ where: { id: sessionId } });
    if (!session) {
      return PbmsResponseDto.fail('Không tìm thấy phiên gửi xe', 404);
    }
    if (session.driverUserId !== userId) {
      return PbmsResponseDto.fail('Bạn không có quyền xem phiên gửi xe này', 403);
    }
    return null;
  }

  private async findCheckoutPayment(paymentId: string) {
    if (isEmptyGuid(paymentId)) {
      return PbmsResponseDto.fail('PaymentId không hợp lệ');
    }
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment || !sameStatus(payment.paymentType ?? '', 'CheckoutFee') || !payment.sessionId) {
      return PbmsResponseDto.fail('Không tìm thấy thanh toán checkout', 404);
    }
    return payment;
  }

  private async loadSession(id: string) {
    const item = await this.prisma.parkingSession.findUnique({
      where: { id },
      include: {
        driverUser: true,
        vehicleType: true,
        entryGate: true,
        exitGate: true,
        assignedSlot: true,
        actualSlot: true,
        payments: { orderBy: { paymentTime: 'desc' }, take: 1 },
      },
    });
    if (!item) {
      return null;
    }
    const mapped = await this.sessions.map(item);
    if (sameStatus(item.status, 'Active')) {
      mapped.ticket = await createTicket(item.id);
    }
    return mapped;
  }

  private mapPayment(
    payment: {
      id: string;
      sessionId: string | null;
      reservationId: string | null;
      amount: Prisma.Decimal;
      paymentMethod: string;
      paymentType: string | null;
      paymentTime: Date;
      paymentStatus: string;
      transactionReference: string | null;
    },
    orderCode?: string,
  ) {
    return {
      paymentId: payment.id,
      sessionId: payment.sessionId,
      reservationId: payment.reservationId,
      amount: toMoney(payment.amount),
      paymentMethod: payment.paymentMethod,
      paymentType: payment.paymentType,
      paymentTime: payment.paymentTime,
      paymentStatus: payment.paymentStatus,
      transactionReference: orderCode ?? payment.transactionReference,
    };
  }

  private normalizeCustomer(value: string): 'Guest' | 'Resident' | 'Reservation' | null {
    const v = value.trim().toLowerCase();
    if (v === 'guest') return 'Guest';
    if (v === 'resident') return 'Resident';
    if (v === 'reservation') return 'Reservation';
    return null;
  }

  private normalizeMethod(value: string): 'PayOS' | 'Cash' | null {
    const v = value.trim().toLowerCase();
    if (v === 'payos') return 'PayOS';
    if (v === 'cash') return 'Cash';
    return null;
  }
}
