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
  toMoney,
} from '../common/pbms-fields';

@Injectable()
export class PricingPoliciesService {
  constructor(private readonly prisma: PrismaService) {}

  async getAll(): Promise<PbmsResponseDto> {
    const items = await this.prisma.pricingPolicy.findMany({
      include: { vehicleType: true },
      orderBy: { effectiveDate: 'desc' },
    });
    if (items.length === 0) {
      return PbmsResponseDto.fail('Không tìm thấy chính sách giá nào', 404);
    }
    return PbmsResponseDto.ok('Lấy danh sách chính sách giá thành công', items.map((p) => this.map(p)));
  }

  async getById(id: string): Promise<PbmsResponseDto> {
    if (isEmptyGuid(id)) {
      return PbmsResponseDto.fail('Vui lòng nhập PricingPolicyId');
    }
    const item = await this.prisma.pricingPolicy.findUnique({
      where: { id },
      include: { vehicleType: true },
    });
    if (!item) {
      return PbmsResponseDto.fail('Không tìm thấy chính sách giá', 404);
    }
    return PbmsResponseDto.ok('Lấy chính sách giá thành công', this.map(item));
  }

  async create(dto: object): Promise<PbmsResponseDto> {
    const vehicleTypeId = pbmsPickGuid(dto, 'vehicleTypeId', 'VehicleTypeId');
    const effectiveDate = pbmsPickDate(dto, 'effectiveDate', 'EffectiveDate');
    if (isEmptyGuid(vehicleTypeId) || !effectiveDate) {
      return PbmsResponseDto.fail('Dữ liệu không hợp lệ');
    }
    const vehicleType = await this.prisma.vehicleType.findUnique({ where: { id: vehicleTypeId } });
    if (!vehicleType) {
      return PbmsResponseDto.fail('Loại phương tiện không tồn tại');
    }
    try {
      const item = await this.prisma.pricingPolicy.create({
        data: {
          vehicleTypeId,
          basePrice: new Prisma.Decimal(pbmsPickNumber(dto, 'basePrice', 'BasePrice') ?? 0),
          baseHours: pbmsPickNumber(dto, 'baseHours', 'BaseHours') ?? 1,
          extraHourPrice: new Prisma.Decimal(pbmsPickNumber(dto, 'extraHourPrice', 'ExtraHourPrice') ?? 0),
          nightSurcharge: new Prisma.Decimal(pbmsPickNumber(dto, 'nightSurcharge', 'NightSurcharge') ?? 0),
          effectiveDate,
          status: pbmsPick(dto, 'status', 'Status').trim() || 'Active',
        },
        include: { vehicleType: true },
      });
      return PbmsResponseDto.ok('Tạo chính sách giá thành công', this.map(item), 201);
    } catch (error: unknown) {
      return PbmsResponseDto.fail(`Lỗi tạo chính sách giá: ${errorMessage(error)}`, 500);
    }
  }

  async update(dto: object): Promise<PbmsResponseDto> {
    const id = pbmsPickGuid(dto, 'policyId', 'PolicyId', 'pricingPolicyId', 'PricingPolicyId');
    if (isEmptyGuid(id)) {
      return PbmsResponseDto.fail('Dữ liệu cập nhật không hợp lệ');
    }
    const existing = await this.prisma.pricingPolicy.findUnique({ where: { id } });
    if (!existing) {
      return PbmsResponseDto.fail('Không tìm thấy chính sách giá', 404);
    }
    const vehicleTypeId = pbmsPickGuid(dto, 'vehicleTypeId', 'VehicleTypeId') || existing.vehicleTypeId;
    const vehicleType = await this.prisma.vehicleType.findUnique({ where: { id: vehicleTypeId } });
    if (!vehicleType) {
      return PbmsResponseDto.fail('Loại phương tiện không tồn tại');
    }
    try {
      const item = await this.prisma.pricingPolicy.update({
        where: { id },
        data: {
          vehicleTypeId,
          basePrice: new Prisma.Decimal(
            pbmsPickNumber(dto, 'basePrice', 'BasePrice') ?? Number(existing.basePrice),
          ),
          baseHours: pbmsPickNumber(dto, 'baseHours', 'BaseHours') ?? existing.baseHours,
          extraHourPrice: new Prisma.Decimal(
            pbmsPickNumber(dto, 'extraHourPrice', 'ExtraHourPrice') ?? Number(existing.extraHourPrice),
          ),
          nightSurcharge: new Prisma.Decimal(
            pbmsPickNumber(dto, 'nightSurcharge', 'NightSurcharge') ?? Number(existing.nightSurcharge),
          ),
          effectiveDate: pbmsPickDate(dto, 'effectiveDate', 'EffectiveDate') ?? existing.effectiveDate,
          status: pbmsPick(dto, 'status', 'Status').trim() || existing.status,
        },
        include: { vehicleType: true },
      });
      return PbmsResponseDto.ok('Cập nhật chính sách giá thành công', this.map(item));
    } catch (error: unknown) {
      return PbmsResponseDto.fail(`Lỗi cập nhật chính sách giá: ${errorMessage(error)}`, 500);
    }
  }

  async remove(id: string): Promise<PbmsResponseDto> {
    if (isEmptyGuid(id)) {
      return PbmsResponseDto.fail('Vui lòng nhập PricingPolicyId');
    }
    const existing = await this.prisma.pricingPolicy.findUnique({ where: { id } });
    if (!existing) {
      return PbmsResponseDto.fail('Không tìm thấy chính sách giá', 404);
    }
    try {
      await this.prisma.pricingPolicy.delete({ where: { id } });
      return PbmsResponseDto.ok('Xóa chính sách giá thành công');
    } catch (error: unknown) {
      return PbmsResponseDto.fail(`Lỗi xóa chính sách giá: ${errorMessage(error)}`, 500);
    }
  }

  private map(item: {
    id: string;
    vehicleTypeId: string;
    basePrice: Prisma.Decimal;
    baseHours: number;
    extraHourPrice: Prisma.Decimal;
    nightSurcharge: Prisma.Decimal;
    effectiveDate: Date;
    status: string;
    vehicleType: { typeName: string };
  }) {
    return {
      policyId: item.id,
      vehicleTypeId: item.vehicleTypeId,
      vehicleTypeName: item.vehicleType.typeName,
      basePrice: toMoney(item.basePrice),
      baseHours: item.baseHours,
      extraHourPrice: toMoney(item.extraHourPrice),
      nightSurcharge: toMoney(item.nightSurcharge),
      effectiveDate: item.effectiveDate,
      status: item.status,
    };
  }
}
