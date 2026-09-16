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
  sameStatus,
  toMoney,
} from '../common/pbms-fields';
import { createTicket } from '../common/qr.util';

@Injectable()
export class ParkingSessionsService {
  constructor(private readonly prisma: PrismaService) {}

  async getAll(): Promise<PbmsResponseDto> {
    const items = await this.prisma.parkingSession.findMany({
      include: this.include(),
      orderBy: { entryTime: 'desc' },
    });
    return PbmsResponseDto.ok(
      'Lấy danh sách phiên gửi xe thành công',
      await Promise.all(items.map((item) => this.map(item))),
    );
  }

  async getMine(userId: string): Promise<PbmsResponseDto> {
    const items = await this.prisma.parkingSession.findMany({
      where: { driverUserId: userId },
      include: this.include(),
      orderBy: { entryTime: 'desc' },
    });
    return PbmsResponseDto.ok(
      'Lấy phiên gửi xe của tôi thành công',
      await Promise.all(items.map((item) => this.map(item))),
    );
  }

  async getById(id: string): Promise<PbmsResponseDto> {
    if (isEmptyGuid(id)) {
      return PbmsResponseDto.fail('Vui lòng nhập SessionId');
    }
    const item = await this.prisma.parkingSession.findUnique({
      where: { id },
      include: this.include(),
    });
    if (!item) {
      return PbmsResponseDto.fail('Không tìm thấy phiên gửi xe', 404);
    }
    return PbmsResponseDto.ok('Lấy phiên gửi xe thành công', await this.map(item));
  }

  async create(dto: object): Promise<PbmsResponseDto> {
    const vehicleTypeId = pbmsPickGuid(dto, 'vehicleTypeId', 'VehicleTypeId');
    const entryGateId = pbmsPickGuid(dto, 'entryGateId', 'EntryGateId');
    const licensePlateIn = pbmsPick(dto, 'licensePlateIn', 'LicensePlateIn').trim();
    if (isEmptyGuid(vehicleTypeId) || isEmptyGuid(entryGateId) || !licensePlateIn) {
      return PbmsResponseDto.fail('Dữ liệu không hợp lệ');
    }
    try {
      const session = await this.prisma.parkingSession.create({
        data: {
          driverUserId: pbmsPickGuid(dto, 'driverUserId', 'DriverUserId') || null,
          licensePlateIn,
          licensePlateOut: pbmsPick(dto, 'licensePlateOut', 'LicensePlateOut').trim() || null,
          entryImageUrl: pbmsPick(dto, 'entryImageUrl', 'EntryImageUrl').trim() || null,
          driverEntryImageUrl: pbmsPick(dto, 'driverEntryImageUrl', 'DriverEntryImageUrl').trim() || null,
          exitImageUrl: pbmsPick(dto, 'exitImageUrl', 'ExitImageUrl').trim() || null,
          driverExitImageUrl: pbmsPick(dto, 'driverExitImageUrl', 'DriverExitImageUrl').trim() || null,
          vehicleTypeId,
          entryTime: pbmsPickDate(dto, 'entryTime', 'EntryTime') ?? new Date(),
          exitTime: pbmsPickDate(dto, 'exitTime', 'ExitTime') ?? null,
          entryGateId,
          exitGateId: pbmsPickGuid(dto, 'exitGateId', 'ExitGateId') || null,
          assignedSlotId: pbmsPickGuid(dto, 'assignedSlotId', 'AssignedSlotId') || null,
          actualSlotId: pbmsPickGuid(dto, 'actualSlotId', 'ActualSlotId') || null,
          status: pbmsPick(dto, 'status', 'Status').trim() || 'Active',
        },
        include: this.include(),
      });
      return PbmsResponseDto.ok('Tạo phiên gửi xe thành công', await this.map(session), 201);
    } catch (error: unknown) {
      return PbmsResponseDto.fail(`Lỗi tạo phiên gửi xe: ${errorMessage(error)}`, 500);
    }
  }

  async update(dto: object): Promise<PbmsResponseDto> {
    const id = pbmsPickGuid(dto, 'sessionId', 'SessionId');
    if (isEmptyGuid(id)) {
      return PbmsResponseDto.fail('Dữ liệu cập nhật không hợp lệ');
    }
    const existing = await this.prisma.parkingSession.findUnique({ where: { id } });
    if (!existing) {
      return PbmsResponseDto.fail('Không tìm thấy phiên gửi xe', 404);
    }
    try {
      const session = await this.prisma.parkingSession.update({
        where: { id },
        data: {
          driverUserId: pbmsPickGuid(dto, 'driverUserId', 'DriverUserId') || existing.driverUserId,
          licensePlateIn: pbmsPick(dto, 'licensePlateIn', 'LicensePlateIn').trim() || existing.licensePlateIn,
          licensePlateOut: pbmsPick(dto, 'licensePlateOut', 'LicensePlateOut').trim() || existing.licensePlateOut,
          entryImageUrl: pbmsPick(dto, 'entryImageUrl', 'EntryImageUrl').trim() || existing.entryImageUrl,
          driverEntryImageUrl:
            pbmsPick(dto, 'driverEntryImageUrl', 'DriverEntryImageUrl').trim() || existing.driverEntryImageUrl,
          exitImageUrl: pbmsPick(dto, 'exitImageUrl', 'ExitImageUrl').trim() || existing.exitImageUrl,
          driverExitImageUrl:
            pbmsPick(dto, 'driverExitImageUrl', 'DriverExitImageUrl').trim() || existing.driverExitImageUrl,
          vehicleTypeId: pbmsPickGuid(dto, 'vehicleTypeId', 'VehicleTypeId') || existing.vehicleTypeId,
          entryTime: pbmsPickDate(dto, 'entryTime', 'EntryTime') ?? existing.entryTime,
          exitTime: pbmsPickDate(dto, 'exitTime', 'ExitTime') ?? existing.exitTime,
          entryGateId: pbmsPickGuid(dto, 'entryGateId', 'EntryGateId') || existing.entryGateId,
          exitGateId: pbmsPickGuid(dto, 'exitGateId', 'ExitGateId') || existing.exitGateId,
          assignedSlotId: pbmsPickGuid(dto, 'assignedSlotId', 'AssignedSlotId') || existing.assignedSlotId,
          actualSlotId: pbmsPickGuid(dto, 'actualSlotId', 'ActualSlotId') || existing.actualSlotId,
          status: pbmsPick(dto, 'status', 'Status').trim() || existing.status,
        },
        include: this.include(),
      });
      return PbmsResponseDto.ok('Cập nhật phiên gửi xe thành công', await this.map(session));
    } catch (error: unknown) {
      return PbmsResponseDto.fail(`Lỗi cập nhật phiên gửi xe: ${errorMessage(error)}`, 500);
    }
  }

  async remove(id: string): Promise<PbmsResponseDto> {
    if (isEmptyGuid(id)) {
      return PbmsResponseDto.fail('Vui lòng nhập SessionId');
    }
    const existing = await this.prisma.parkingSession.findUnique({ where: { id } });
    if (!existing) {
      return PbmsResponseDto.fail('Không tìm thấy phiên gửi xe', 404);
    }
    try {
      await this.prisma.parkingSession.delete({ where: { id } });
      return PbmsResponseDto.ok('Xóa phiên gửi xe thành công');
    } catch (error: unknown) {
      return PbmsResponseDto.fail(`Lỗi xóa phiên gửi xe: ${errorMessage(error)}`, 500);
    }
  }

  private include() {
    return {
      driverUser: true,
      vehicleType: true,
      entryGate: true,
      exitGate: true,
      assignedSlot: true,
      actualSlot: true,
      payments: { orderBy: { paymentTime: 'desc' as const }, take: 1 },
    };
  }

  async map(item: {
    id: string;
    reservationId: string | null;
    driverUserId: string | null;
    driverUser: { fullName: string | null } | null;
    licensePlateIn: string;
    licensePlateOut: string | null;
    entryImageUrl: string | null;
    driverEntryImageUrl: string | null;
    exitImageUrl: string | null;
    driverExitImageUrl: string | null;
    vehicleTypeId: string;
    vehicleType: { typeName: string };
    entryTime: Date;
    exitTime: Date | null;
    entryGateId: string;
    entryGate: { gateName: string };
    exitGateId: string | null;
    exitGate: { gateName: string } | null;
    assignedSlotId: string | null;
    assignedSlot: { slotCode: string } | null;
    actualSlotId: string | null;
    actualSlot: { slotCode: string } | null;
    status: string;
    payments: Array<{
      amount: Prisma.Decimal;
      paymentStatus: string;
      paymentMethod: string;
      paymentTime: Date;
    }>;
  }) {
    const payment = item.payments[0];
    return {
      sessionId: item.id,
      reservationId: item.reservationId,
      driverUserId: item.driverUserId,
      driverFullName: item.driverUser?.fullName ?? null,
      licensePlateIn: item.licensePlateIn,
      licensePlateOut: item.licensePlateOut,
      entryImageUrl: item.entryImageUrl,
      driverEntryImageUrl: item.driverEntryImageUrl,
      exitImageUrl: item.exitImageUrl,
      driverExitImageUrl: item.driverExitImageUrl,
      vehicleTypeId: item.vehicleTypeId,
      vehicleTypeName: item.vehicleType.typeName,
      entryTime: item.entryTime,
      exitTime: item.exitTime,
      entryGateId: item.entryGateId,
      entryGateName: item.entryGate.gateName,
      exitGateId: item.exitGateId,
      exitGateName: item.exitGate?.gateName ?? null,
      assignedSlotId: item.assignedSlotId,
      assignedSlotCode: item.assignedSlot?.slotCode ?? null,
      actualSlotId: item.actualSlotId,
      actualSlotCode: item.actualSlot?.slotCode ?? null,
      status: item.status,
      paymentAmount: payment ? toMoney(payment.amount) : null,
      paymentStatus: payment?.paymentStatus ?? null,
      paymentMethod: payment?.paymentMethod ?? null,
      paymentTime: payment?.paymentTime ?? null,
      ticket: sameStatus(item.status, 'Active') ? await createTicket(item.id) : null,
    };
  }
}
