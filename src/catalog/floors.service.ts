import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import { isEmptyGuid, pbmsPick, pbmsPickBool, pbmsPickGuid, pbmsPickNumber } from '../common/pbms-fields';

@Injectable()
export class FloorsService {
  constructor(private readonly prisma: PrismaService) {}

  async getAll(): Promise<PbmsResponseDto> {
    const floors = await this.prisma.floor.findMany({
      include: { dedicatedVehicleType: true },
      orderBy: { floorName: 'asc' },
    });
    if (floors.length === 0) {
      return PbmsResponseDto.fail('Không tìm thấy tầng nào', 404);
    }
    return PbmsResponseDto.ok('Lấy danh sách tầng thành công', floors.map((f) => this.map(f)));
  }

  async getById(id: string): Promise<PbmsResponseDto> {
    if (isEmptyGuid(id)) {
      return PbmsResponseDto.fail('Vui lòng nhập FloorId');
    }
    const floor = await this.prisma.floor.findUnique({
      where: { id },
      include: { dedicatedVehicleType: true },
    });
    if (!floor) {
      return PbmsResponseDto.fail('Không tìm thấy tầng', 404);
    }
    return PbmsResponseDto.ok('Lấy thông tin tầng thành công', this.map(floor));
  }

  async create(dto: object): Promise<PbmsResponseDto> {
    const validation = await this.validate(
      pbmsPick(dto, 'floorName', 'FloorName'),
      pbmsPickGuid(dto, 'dedicatedVehicleTypeId', 'DedicatedVehicleTypeId'),
      null,
    );
    if (validation.error) {
      return validation.error;
    }
    try {
      const floor = await this.prisma.floor.create({
        data: {
          floorName: pbmsPick(dto, 'floorName', 'FloorName').trim(),
          dedicatedVehicleTypeId: validation.vehicleTypeId,
          totalCapacity: pbmsPickNumber(dto, 'totalCapacity', 'TotalCapacity') ?? 0,
          isResident: pbmsPickBool(dto, 'isResident', 'IsResident') ?? false,
        },
        include: { dedicatedVehicleType: true },
      });
      return PbmsResponseDto.ok('Tạo tầng thành công', this.map(floor), 201);
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return PbmsResponseDto.fail('Dữ liệu tầng bị trùng hoặc không hợp lệ');
      }
      const message = error instanceof Error ? error.message : 'unknown';
      return PbmsResponseDto.fail(`Lỗi tạo tầng: ${message}`, 500);
    }
  }

  async update(dto: object): Promise<PbmsResponseDto> {
    const id = pbmsPickGuid(dto, 'floorId', 'FloorId');
    if (isEmptyGuid(id)) {
      return PbmsResponseDto.fail('Dữ liệu cập nhật không hợp lệ');
    }
    const existing = await this.prisma.floor.findUnique({ where: { id } });
    if (!existing) {
      return PbmsResponseDto.fail('Không tìm thấy tầng', 404);
    }
    const validation = await this.validate(
      pbmsPick(dto, 'floorName', 'FloorName'),
      pbmsPickGuid(dto, 'dedicatedVehicleTypeId', 'DedicatedVehicleTypeId'),
      id,
    );
    if (validation.error) {
      return validation.error;
    }
    try {
      const floor = await this.prisma.floor.update({
        where: { id },
        data: {
          floorName: pbmsPick(dto, 'floorName', 'FloorName').trim(),
          dedicatedVehicleTypeId: validation.vehicleTypeId,
          totalCapacity: pbmsPickNumber(dto, 'totalCapacity', 'TotalCapacity') ?? existing.totalCapacity,
          isResident: pbmsPickBool(dto, 'isResident', 'IsResident') ?? existing.isResident,
        },
        include: { dedicatedVehicleType: true },
      });
      return PbmsResponseDto.ok('Cập nhật tầng thành công', this.map(floor));
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return PbmsResponseDto.fail('Dữ liệu tầng bị trùng hoặc không hợp lệ');
      }
      const message = error instanceof Error ? error.message : 'unknown';
      return PbmsResponseDto.fail(`Lỗi cập nhật tầng: ${message}`, 500);
    }
  }

  async remove(id: string): Promise<PbmsResponseDto> {
    if (isEmptyGuid(id)) {
      return PbmsResponseDto.fail('Vui lòng nhập FloorId');
    }
    const existing = await this.prisma.floor.findUnique({ where: { id } });
    if (!existing) {
      return PbmsResponseDto.fail('Không tìm thấy tầng', 404);
    }
    try {
      await this.prisma.floor.delete({ where: { id } });
      return PbmsResponseDto.ok('Xóa tầng thành công');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'unknown';
      return PbmsResponseDto.fail(`Lỗi xóa tầng: ${message}`, 500);
    }
  }

  private map(floor: {
    id: string;
    floorName: string;
    dedicatedVehicleTypeId: string | null;
    dedicatedVehicleType: { typeName: string } | null;
    totalCapacity: number;
    isResident: boolean;
  }) {
    return {
      floorId: floor.id,
      floorName: floor.floorName,
      dedicatedVehicleTypeId: floor.dedicatedVehicleTypeId,
      dedicatedVehicleTypeName: floor.dedicatedVehicleType?.typeName ?? null,
      totalCapacity: floor.totalCapacity,
      isResident: floor.isResident,
    };
  }

  private async validate(floorName: string, vehicleTypeId: string, currentId: string | null) {
    const trimmed = floorName.trim();
    if (!trimmed) {
      return { vehicleTypeId: null as string | null, error: PbmsResponseDto.fail('Vui lòng nhập tên tầng') };
    }
    const dup = await this.prisma.floor.findFirst({
      where: {
        floorName: { equals: trimmed, mode: 'insensitive' },
        ...(currentId ? { NOT: { id: currentId } } : {}),
      },
    });
    if (dup) {
      return { vehicleTypeId: null as string | null, error: PbmsResponseDto.fail('Tên tầng đã tồn tại') };
    }
    if (!isEmptyGuid(vehicleTypeId)) {
      const vt = await this.prisma.vehicleType.findUnique({ where: { id: vehicleTypeId } });
      if (!vt) {
        return {
          vehicleTypeId: null as string | null,
          error: PbmsResponseDto.fail('Loại phương tiện chuyên dụng không tồn tại'),
        };
      }
      return { vehicleTypeId, error: null };
    }
    return { vehicleTypeId: null as string | null, error: null };
  }
}
