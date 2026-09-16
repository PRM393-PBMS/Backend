import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import {
  errorMessage,
  isEmptyGuid,
  pbmsPick,
  pbmsPickBool,
  pbmsPickGuid,
  pbmsPickNumber,
  toMoney,
} from '../common/pbms-fields';

@Injectable()
export class SubscriptionPackagesService {
  constructor(private readonly prisma: PrismaService) {}

  async getAll(): Promise<PbmsResponseDto> {
    const items = await this.prisma.subscriptionPackage.findMany({
      include: { vehicleType: true },
      orderBy: { packageName: 'asc' },
    });
    if (items.length === 0) {
      return PbmsResponseDto.fail('Không tìm thấy gói thuê bao nào', 404);
    }
    return PbmsResponseDto.ok('Lấy danh sách gói thuê bao thành công', items.map((p) => this.map(p)));
  }

  async getById(id: string): Promise<PbmsResponseDto> {
    if (isEmptyGuid(id)) {
      return PbmsResponseDto.fail('Vui lòng nhập PackageId');
    }
    const item = await this.prisma.subscriptionPackage.findUnique({
      where: { id },
      include: { vehicleType: true },
    });
    if (!item) {
      return PbmsResponseDto.fail('Không tìm thấy gói thuê bao', 404);
    }
    return PbmsResponseDto.ok('Lấy gói thuê bao thành công', this.map(item));
  }

  async create(dto: object): Promise<PbmsResponseDto> {
    const vehicleTypeId = pbmsPickGuid(dto, 'vehicleTypeId', 'VehicleTypeId');
    const packageName = pbmsPick(dto, 'packageName', 'PackageName').trim();
    if (isEmptyGuid(vehicleTypeId) || !packageName) {
      return PbmsResponseDto.fail('Dữ liệu không hợp lệ');
    }
    const vehicleType = await this.prisma.vehicleType.findUnique({ where: { id: vehicleTypeId } });
    if (!vehicleType) {
      return PbmsResponseDto.fail('Loại phương tiện không tồn tại');
    }
    try {
      const item = await this.prisma.subscriptionPackage.create({
        data: {
          vehicleTypeId,
          packageName,
          durationMonths: pbmsPickNumber(dto, 'durationMonths', 'DurationMonths') ?? 1,
          price: new Prisma.Decimal(pbmsPickNumber(dto, 'price', 'Price') ?? 0),
          requireFixedSlot: pbmsPickBool(dto, 'requireFixedSlot', 'RequireFixedSlot') ?? false,
          description: pbmsPick(dto, 'description', 'Description').trim() || null,
          status: pbmsPick(dto, 'status', 'Status').trim() || 'Active',
        },
        include: { vehicleType: true },
      });
      return PbmsResponseDto.ok('Tạo gói thuê bao thành công', this.map(item), 201);
    } catch (error: unknown) {
      return PbmsResponseDto.fail(`Lỗi tạo gói thuê bao: ${errorMessage(error)}`, 500);
    }
  }

  async update(id: string, dto: object): Promise<PbmsResponseDto> {
    if (isEmptyGuid(id)) {
      return PbmsResponseDto.fail('Dữ liệu cập nhật không hợp lệ');
    }
    const existing = await this.prisma.subscriptionPackage.findUnique({ where: { id } });
    if (!existing) {
      return PbmsResponseDto.fail('Không tìm thấy gói thuê bao', 404);
    }
    const vehicleTypeId = pbmsPickGuid(dto, 'vehicleTypeId', 'VehicleTypeId') || existing.vehicleTypeId;
    const vehicleType = await this.prisma.vehicleType.findUnique({ where: { id: vehicleTypeId } });
    if (!vehicleType) {
      return PbmsResponseDto.fail('Loại phương tiện không tồn tại');
    }
    try {
      const item = await this.prisma.subscriptionPackage.update({
        where: { id },
        data: {
          vehicleTypeId,
          packageName: pbmsPick(dto, 'packageName', 'PackageName').trim() || existing.packageName,
          durationMonths: pbmsPickNumber(dto, 'durationMonths', 'DurationMonths') ?? existing.durationMonths,
          price: new Prisma.Decimal(pbmsPickNumber(dto, 'price', 'Price') ?? Number(existing.price)),
          requireFixedSlot: pbmsPickBool(dto, 'requireFixedSlot', 'RequireFixedSlot') ?? existing.requireFixedSlot,
          description: pbmsPick(dto, 'description', 'Description').trim() || existing.description,
          status: pbmsPick(dto, 'status', 'Status').trim() || existing.status,
        },
        include: { vehicleType: true },
      });
      return PbmsResponseDto.ok('Cập nhật gói thuê bao thành công', this.map(item));
    } catch (error: unknown) {
      return PbmsResponseDto.fail(`Lỗi cập nhật gói thuê bao: ${errorMessage(error)}`, 500);
    }
  }

  async remove(id: string): Promise<PbmsResponseDto> {
    if (isEmptyGuid(id)) {
      return PbmsResponseDto.fail('Vui lòng nhập PackageId');
    }
    const existing = await this.prisma.subscriptionPackage.findUnique({ where: { id } });
    if (!existing) {
      return PbmsResponseDto.fail('Không tìm thấy gói thuê bao', 404);
    }
    try {
      await this.prisma.subscriptionPackage.delete({ where: { id } });
      return PbmsResponseDto.ok('Xóa gói thuê bao thành công');
    } catch (error: unknown) {
      return PbmsResponseDto.fail(`Lỗi xóa gói thuê bao: ${errorMessage(error)}`, 500);
    }
  }

  private map(item: {
    id: string;
    vehicleTypeId: string;
    packageName: string;
    durationMonths: number;
    price: Prisma.Decimal;
    requireFixedSlot: boolean;
    description: string | null;
    status: string;
    vehicleType: { typeName: string };
  }) {
    return {
      packageId: item.id,
      packageName: item.packageName,
      vehicleTypeId: item.vehicleTypeId,
      vehicleTypeName: item.vehicleType.typeName,
      durationMonths: item.durationMonths,
      price: toMoney(item.price),
      requireFixedSlot: item.requireFixedSlot,
      description: item.description,
      status: item.status,
    };
  }
}
