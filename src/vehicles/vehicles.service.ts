import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import { isEmptyGuid, pbmsPick, pbmsPickGuid } from '../common/pbms-fields';
import { isValidLicensePlate, normalizeLicensePlate } from '../common/license-plate';
import { PrismaService } from '../prisma/prisma.service';

const includeVehicleType = { vehicleType: true } as const;

@Injectable()
export class VehiclesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: object): Promise<PbmsResponseDto> {
    const vehicleTypeId = pbmsPickGuid(dto, 'vehicleTypeId', 'VehicleTypeId');
    const licensePlate = normalizeLicensePlate(pbmsPick(dto, 'licensePlate', 'LicensePlate'));
    if (isEmptyGuid(vehicleTypeId) || !isValidLicensePlate(licensePlate)) {
      return PbmsResponseDto.fail('Vui lòng nhập loại xe và biển số hợp lệ (4-15 chữ/số)');
    }
    try {
      const vehicle = await this.prisma.vehicle.create({
        data: { userId, vehicleTypeId, licensePlate },
        include: includeVehicleType,
      });
      return PbmsResponseDto.ok('Đăng ký xe thành công', this.map(vehicle), 201);
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return PbmsResponseDto.fail('Biển số xe đã được đăng ký', 409);
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        return PbmsResponseDto.fail('Loại phương tiện không tồn tại', 404);
      }
      return PbmsResponseDto.fail('Không thể đăng ký xe', 500);
    }
  }

  async getMine(userId: string): Promise<PbmsResponseDto> {
    const vehicles = await this.prisma.vehicle.findMany({
      where: { userId },
      include: includeVehicleType,
      orderBy: { createdAt: 'desc' },
    });
    return PbmsResponseDto.ok('Lấy danh sách xe thành công', vehicles.map((vehicle) => this.map(vehicle)));
  }

  async getById(userId: string, id: string): Promise<PbmsResponseDto> {
    const vehicle = await this.findOwned(userId, id);
    return vehicle instanceof PbmsResponseDto
      ? vehicle
      : PbmsResponseDto.ok('Lấy thông tin xe thành công', this.map(vehicle));
  }

  async update(userId: string, id: string, dto: object): Promise<PbmsResponseDto> {
    const vehicle = await this.findOwned(userId, id);
    if (vehicle instanceof PbmsResponseDto) return vehicle;
    const rawPlate = pbmsPick(dto, 'licensePlate', 'LicensePlate');
    const rawTypeId = pbmsPickGuid(dto, 'vehicleTypeId', 'VehicleTypeId');
    const licensePlate = rawPlate ? normalizeLicensePlate(rawPlate) : vehicle.licensePlate;
    if (rawPlate && !isValidLicensePlate(licensePlate)) {
      return PbmsResponseDto.fail('Biển số phải gồm 4-15 chữ cái và chữ số');
    }
    if (!rawPlate && !rawTypeId) return PbmsResponseDto.fail('Không có thông tin xe để cập nhật');
    const hasUsage = await this.prisma.$transaction([
      this.prisma.monthlySubscription.count({ where: { vehicleId: id } }),
      this.prisma.reservation.count({ where: { vehicleId: id } }),
      this.prisma.parkingSession.count({ where: { vehicleId: id, status: 'Active' } }),
    ]);
    if (rawTypeId && (hasUsage[0] > 0 || hasUsage[1] > 0)) {
      return PbmsResponseDto.fail('Không thể đổi loại xe đã được dùng cho gói tháng hoặc đặt chỗ', 409);
    }
    if (rawPlate && hasUsage[0] > 0) {
      return PbmsResponseDto.fail('Xe có gói tháng; hãy dùng quy trình yêu cầu đổi xe', 409);
    }
    if (rawPlate && hasUsage[2] > 0) {
      return PbmsResponseDto.fail('Không thể đổi biển số khi xe đang trong phiên gửi xe', 409);
    }
    try {
      const updated = await this.prisma.vehicle.update({
        where: { id },
        data: { licensePlate, ...(rawTypeId ? { vehicleTypeId: rawTypeId } : {}) },
        include: includeVehicleType,
      });
      return PbmsResponseDto.ok('Cập nhật xe thành công', this.map(updated));
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return PbmsResponseDto.fail('Biển số xe đã được đăng ký', 409);
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        return PbmsResponseDto.fail('Loại phương tiện không tồn tại', 404);
      }
      return PbmsResponseDto.fail('Không thể cập nhật xe', 500);
    }
  }

  async remove(userId: string, id: string): Promise<PbmsResponseDto> {
    const vehicle = await this.findOwned(userId, id);
    if (vehicle instanceof PbmsResponseDto) return vehicle;
    const usage = await this.prisma.$transaction([
      this.prisma.monthlySubscription.count({ where: { vehicleId: id } }),
      this.prisma.reservation.count({ where: { vehicleId: id } }),
      this.prisma.parkingSession.count({ where: { vehicleId: id } }),
    ]);
    if (usage.some((count) => count > 0)) {
      return PbmsResponseDto.fail('Không thể xóa xe đã được dùng trong gói tháng, đặt chỗ hoặc phiên gửi xe', 409);
    }
    await this.prisma.vehicle.delete({ where: { id } });
    return PbmsResponseDto.ok('Xóa xe thành công');
  }

  private async findOwned(userId: string, id: string) {
    if (isEmptyGuid(id)) return PbmsResponseDto.fail('VehicleId không hợp lệ');
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id, userId },
      include: includeVehicleType,
    });
    return vehicle ?? PbmsResponseDto.fail('Không tìm thấy xe hoặc bạn không có quyền truy cập', 404);
  }

  private map(vehicle: {
    id: string;
    userId: string;
    vehicleTypeId: string;
    licensePlate: string;
    vehicleType: { typeName: string };
  }) {
    return {
      vehicleId: vehicle.id,
      userId: vehicle.userId,
      vehicleTypeId: vehicle.vehicleTypeId,
      vehicleTypeName: vehicle.vehicleType.typeName,
      licensePlate: vehicle.licensePlate,
    };
  }
}
