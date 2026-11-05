import { AppError } from '../common/errors';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import {
  isEmptyGuid,
  pbmsPick,
  pbmsPickDate,
  pbmsPickGuid,
  sameStatus,
  toMoney,
} from '../common/pbms-fields';
import { mapExitPass } from '../common/exit-pass';
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
      where: { vehicle: { userId } },
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
    return PbmsResponseDto.ok(
      'Lấy phiên gửi xe thành công',
      await this.map(item),
    );
  }

  async create(_dto: object): Promise<PbmsResponseDto> {
    throw new AppError(
      409,
      'USE_CHECKIN_WORKFLOW',
      'Hãy dùng luồng check-in để tạo phiên và chiếm ô nguyên tử',
    );
  }

  async update(dto: object): Promise<PbmsResponseDto> {
    const blocked = [
      'vehicleId',
      'licensePlateIn',
      'vehicleTypeId',
      'entryTime',
      'exitTime',
      'entryGateId',
      'exitGateId',
      'assignedSlotId',
      'actualSlotId',
      'status',
    ];
    if (
      Object.keys(dto).some((k) =>
        blocked.some((b) => b.toLowerCase() === k.toLowerCase()),
      )
    )
      throw new AppError(
        409,
        'USE_PARKING_WORKFLOW',
        'Thông tin vận hành phải thay đổi qua check-in/checkout',
      );
    const id = pbmsPickGuid(dto, 'sessionId', 'SessionId');
    if (isEmptyGuid(id)) {
      return PbmsResponseDto.fail('Dữ liệu cập nhật không hợp lệ');
    }
    const existing = await this.prisma.parkingSession.findUnique({
      where: { id },
    });
    if (!existing) {
      return PbmsResponseDto.fail('Không tìm thấy phiên gửi xe', 404);
    }
    try {
      const session = await this.prisma.parkingSession.update({
        where: { id },
        data: {
          vehicleId:
            pbmsPickGuid(dto, 'vehicleId', 'VehicleId') || existing.vehicleId,
          licensePlateIn:
            pbmsPick(dto, 'licensePlateIn', 'LicensePlateIn').trim() ||
            existing.licensePlateIn,
          licensePlateOut:
            pbmsPick(dto, 'licensePlateOut', 'LicensePlateOut').trim() ||
            existing.licensePlateOut,
          entryImageUrl:
            pbmsPick(dto, 'entryImageUrl', 'EntryImageUrl').trim() ||
            existing.entryImageUrl,
          driverEntryImageUrl:
            pbmsPick(
              dto,
              'driverEntryImageUrl',
              'DriverEntryImageUrl',
            ).trim() || existing.driverEntryImageUrl,
          exitImageUrl:
            pbmsPick(dto, 'exitImageUrl', 'ExitImageUrl').trim() ||
            existing.exitImageUrl,
          driverExitImageUrl:
            pbmsPick(dto, 'driverExitImageUrl', 'DriverExitImageUrl').trim() ||
            existing.driverExitImageUrl,
          vehicleTypeId:
            pbmsPickGuid(dto, 'vehicleTypeId', 'VehicleTypeId') ||
            existing.vehicleTypeId,
          entryTime:
            pbmsPickDate(dto, 'entryTime', 'EntryTime') ?? existing.entryTime,
          exitTime:
            pbmsPickDate(dto, 'exitTime', 'ExitTime') ?? existing.exitTime,
          entryGateId:
            pbmsPickGuid(dto, 'entryGateId', 'EntryGateId') ||
            existing.entryGateId,
          exitGateId:
            pbmsPickGuid(dto, 'exitGateId', 'ExitGateId') ||
            existing.exitGateId,
          assignedSlotId:
            pbmsPickGuid(dto, 'assignedSlotId', 'AssignedSlotId') ||
            existing.assignedSlotId,
          actualSlotId:
            pbmsPickGuid(dto, 'actualSlotId', 'ActualSlotId') ||
            existing.actualSlotId,
          status: pbmsPick(dto, 'status', 'Status').trim() || existing.status,
        },
        include: this.include(),
      });
      return PbmsResponseDto.ok(
        'Cập nhật phiên gửi xe thành công',
        await this.map(session),
      );
    } catch (error: unknown) {
      return PbmsResponseDto.fromError(error);
    }
  }

  async remove(id: string): Promise<PbmsResponseDto> {
    if (isEmptyGuid(id)) {
      return PbmsResponseDto.fail('Vui lòng nhập SessionId');
    }
    const existing = await this.prisma.parkingSession.findUnique({
      where: { id },
    });
    if (!existing) {
      return PbmsResponseDto.fail('Không tìm thấy phiên gửi xe', 404);
    }
    throw new AppError(
      409,
      'PARKING_HISTORY_PROTECTED',
      'Không thể xóa lịch sử gửi xe; hãy xử lý qua luồng nghiệp vụ',
    );
  }

  private include() {
    return {
      vehicle: { include: { user: true } },
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
    vehicleId: string | null;
    vehicle: {
      licensePlate: string;
      user: { id: string; fullName: string | null };
    } | null;
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
    prepaidAt?: Date | null;
    exitPassCode?: string | null;
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
      vehicleId: item.vehicleId,
      vehicleOwnerId: item.vehicle?.user.id ?? null,
      vehicleOwnerFullName: item.vehicle?.user.fullName ?? null,
      licensePlateIn: item.licensePlateIn,
      registeredLicensePlate: item.vehicle?.licensePlate ?? null,
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
      ticket: sameStatus(item.status, 'Active')
        ? await createTicket(item.id)
        : null,
      prepaidAt: item.prepaidAt ?? null,
      exitPass: await mapExitPass({
        id: item.id,
        status: item.status,
        prepaidAt: item.prepaidAt ?? null,
        exitPassCode: item.exitPassCode ?? null,
      }),
    };
  }
}
