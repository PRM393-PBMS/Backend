import { AppError } from '../common/errors';
import { lockResource } from '../common/transactions';
import { isUUID } from 'class-validator';
import { Injectable } from '@nestjs/common';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import {
  ENTRY_PASS_TTL_HOURS,
  generateEntryPassCode,
  mapEntryPass,
} from '../common/entry-pass';
import { isEmptyGuid, pbmsPickGuid } from '../common/pbms-fields';
import { PrismaService } from '../prisma/prisma.service';

const includeVehicle = {
  vehicle: { include: { vehicleType: true } },
  parking: true,
} as const;

/**
 * Mã QR gửi xe một lần: khách tạo cho một xe đã đăng ký, quét ở cổng vào để
 * check-in như xe vãng lai. Dùng một lần, hết hạn sau 24 giờ, huỷ được.
 */
@Injectable()
export class EntryPassesService {
  constructor(private readonly prisma: PrismaService) {}

  async parkings(vehicleTypeId: string): Promise<PbmsResponseDto> {
    if (!isUUID(vehicleTypeId))
      return PbmsResponseDto.fail('Vui lòng chọn loại xe hợp lệ');
    const parkings = await this.prisma.parking.findMany({
      where: {
        floors: {
          some: {
            isResident: false,
            dedicatedVehicleTypeId: vehicleTypeId,
            gates: { some: { gateType: 'Entry' } },
          },
        },
      },
      select: { id: true, name: true, location: true },
      orderBy: { name: 'asc' },
    });
    return PbmsResponseDto.ok(
      'Danh sách bãi nhận gửi một lần',
      parkings.map((p) => ({
        parkingId: p.id,
        name: p.name,
        location: p.location,
      })),
    );
  }

  async create(userId: string, dto: object): Promise<PbmsResponseDto> {
    const vehicleId = pbmsPickGuid(dto, 'vehicleId', 'VehicleId');
    if (!isUUID(vehicleId) || isEmptyGuid(vehicleId)) {
      return PbmsResponseDto.fail('Vui lòng chọn xe');
    }
    const parkingId = pbmsPickGuid(dto, 'parkingId', 'ParkingId');
    if (!isUUID(parkingId) || isEmptyGuid(parkingId))
      return PbmsResponseDto.fail('Vui lòng chọn bãi gửi xe');
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, userId },
    });
    if (!vehicle) {
      return PbmsResponseDto.fail(
        'Không tìm thấy xe hoặc xe không thuộc tài khoản của bạn',
        404,
      );
    }
    const inside = await this.prisma.parkingSession.findFirst({
      where: { licensePlateIn: vehicle.licensePlate, status: 'Active' },
      select: { id: true },
    });
    if (inside) {
      return PbmsResponseDto.fail(
        'Xe đang ở trong bãi, không cần mã vào bãi',
        409,
      );
    }
    const now = new Date();
    // Vé tháng còn hạn: cổng nhận xe theo vé tháng, đăng ký gửi một lần sẽ không được dùng tới.
    const monthly = await this.prisma.monthlySubscription.findFirst({
      where: {
        vehicleId,
        status: 'Active',
        startDate: { lte: now },
        endDate: { gte: now },
      },
      select: { id: true },
    });
    if (monthly) {
      return PbmsResponseDto.fail(
        'Xe đang có vé tháng còn hạn, tới cổng là vào bằng vé tháng, không cần đăng ký gửi một lần',
        409,
      );
    }
    const expiresAt = new Date(now.getTime() + ENTRY_PASS_TTL_HOURS * 36e5);
    // Mỗi xe chỉ giữ một mã còn hiệu lực: mã cũ bị huỷ khi tạo mã mới.
    const pass = await this.prisma.$transaction(async (tx) => {
      await lockResource(tx, 'gate-entry');
      const busy = await tx.parkingSession.findFirst({
        where: {
          licensePlateIn: vehicle.licensePlate,
          status: { in: ['Active', 'Exception'] },
        },
      });
      if (busy) throw new AppError(409, 'VEHICLE_INSIDE', 'Xe đang trong bãi');
      const monthly = await tx.monthlySubscription.findFirst({
        where: {
          vehicleId,
          status: 'Active',
          startDate: { lte: now },
          endDate: { gt: now },
        },
      });
      if (monthly)
        throw new AppError(
          409,
          'MONTHLY_PASS_ACTIVE',
          'Xe đã có vé tháng còn hiệu lực',
        );
      const eligible = await tx.parking.findFirst({
        where: {
          id: parkingId,
          floors: {
            some: {
              isResident: false,
              dedicatedVehicleTypeId: vehicle.vehicleTypeId,
              gates: { some: { gateType: 'Entry' } },
            },
          },
        },
        select: { id: true },
      });
      if (!eligible)
        throw new AppError(
          409,
          'ENTRY_PARKING_UNAVAILABLE',
          'Bãi đã chọn chưa nhận loại xe này. Vui lòng chọn bãi khác',
        );
      await tx.entryPass.updateMany({
        where: { vehicleId, status: 'Active' },
        data: { status: 'Cancelled' },
      });
      return tx.entryPass.create({
        data: {
          userId,
          vehicleId,
          parkingId,
          code: generateEntryPassCode(),
          expiresAt,
        },
        include: includeVehicle,
      });
    });
    return PbmsResponseDto.ok(
      'Đã tạo mã vào bãi một lần',
      await mapEntryPass(pass),
      201,
    );
  }

  async getMine(userId: string): Promise<PbmsResponseDto> {
    const passes = await this.prisma.entryPass.findMany({
      where: { userId },
      include: includeVehicle,
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return PbmsResponseDto.ok(
      'Lấy mã vào bãi thành công',
      await Promise.all(passes.map((p) => mapEntryPass(p))),
    );
  }

  async cancel(userId: string, id: string): Promise<PbmsResponseDto> {
    if (isEmptyGuid(id)) {
      return PbmsResponseDto.fail('Mã không hợp lệ');
    }
    const { count } = await this.prisma.entryPass.updateMany({
      where: { id, userId, status: 'Active' },
      data: { status: 'Cancelled' },
    });
    return count === 0
      ? PbmsResponseDto.fail('Không tìm thấy mã còn hiệu lực để huỷ', 404)
      : PbmsResponseDto.ok('Đã huỷ mã vào bãi');
  }
}
