import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import { isEmptyGuid, pbmsPick, pbmsPickGuid } from '../common/pbms-fields';

@Injectable()
export class VehicleTypesService {
  constructor(private readonly prisma: PrismaService) {}

  async getAll(): Promise<PbmsResponseDto> {
    const items = await this.prisma.vehicleType.findMany({ orderBy: { typeName: 'asc' } });
    if (items.length === 0) {
      return PbmsResponseDto.fail('Không tìm thấy loại phương tiện nào', 404);
    }
    return PbmsResponseDto.ok(
      'Lấy danh sách loại phương tiện thành công',
      items.map((v) => this.map(v)),
    );
  }

  async getById(id: string): Promise<PbmsResponseDto> {
    if (isEmptyGuid(id)) {
      return PbmsResponseDto.fail('Vui lòng nhập VehicleTypeId');
    }
    const item = await this.prisma.vehicleType.findUnique({ where: { id } });
    if (!item) {
      return PbmsResponseDto.fail('Không tìm thấy loại phương tiện', 404);
    }
    return PbmsResponseDto.ok('Lấy loại phương tiện thành công', this.map(item));
  }

  async create(dto: object): Promise<PbmsResponseDto> {
    const typeName = pbmsPick(dto, 'typeName', 'TypeName').trim();
    if (!typeName) {
      return PbmsResponseDto.fail('Dữ liệu không hợp lệ');
    }
    const exists = await this.prisma.vehicleType.findFirst({
      where: { typeName: { equals: typeName, mode: 'insensitive' } },
    });
    if (exists) {
      return PbmsResponseDto.fail('Tên loại phương tiện đã tồn tại');
    }
    const dimensions = pbmsPick(dto, 'dimensions', 'Dimensions').trim() || null;
    try {
      const item = await this.prisma.vehicleType.create({ data: { typeName, dimensions } });
      return PbmsResponseDto.ok('Tạo loại phương tiện thành công', this.map(item), 201);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'unknown';
      return PbmsResponseDto.fail(`Lỗi tạo loại phương tiện: ${message}`, 500);
    }
  }

  async update(dto: object): Promise<PbmsResponseDto> {
    const id = pbmsPickGuid(dto, 'vehicleTypeId', 'VehicleTypeId');
    if (isEmptyGuid(id)) {
      return PbmsResponseDto.fail('Dữ liệu không hợp lệ');
    }
    const existing = await this.prisma.vehicleType.findUnique({ where: { id } });
    if (!existing) {
      return PbmsResponseDto.fail('Không tìm thấy loại phương tiện', 404);
    }
    const typeName = pbmsPick(dto, 'typeName', 'TypeName').trim();
    if (!typeName) {
      return PbmsResponseDto.fail('Vui lòng nhập TypeName');
    }
    const dup = await this.prisma.vehicleType.findFirst({
      where: { typeName: { equals: typeName, mode: 'insensitive' }, NOT: { id } },
    });
    if (dup) {
      return PbmsResponseDto.fail('TypeName đã tồn tại');
    }
    try {
      const item = await this.prisma.vehicleType.update({
        where: { id },
        data: {
          typeName,
          dimensions: pbmsPick(dto, 'dimensions', 'Dimensions').trim() || null,
        },
      });
      return PbmsResponseDto.ok('Cập nhật loại phương tiện thành công', this.map(item));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'unknown';
      return PbmsResponseDto.fail(`Lỗi cập nhật loại phương tiện: ${message}`, 500);
    }
  }

  async remove(id: string): Promise<PbmsResponseDto> {
    if (isEmptyGuid(id)) {
      return PbmsResponseDto.fail('Vui lòng nhập VehicleTypeId');
    }
    const existing = await this.prisma.vehicleType.findUnique({ where: { id } });
    if (!existing) {
      return PbmsResponseDto.fail('Không tìm thấy loại phương tiện', 404);
    }
    try {
      await this.prisma.vehicleType.delete({ where: { id } });
      return PbmsResponseDto.ok('Xóa loại phương tiện thành công');
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        return PbmsResponseDto.fail(`Lỗi xóa loại phương tiện: ${error.message}`, 500);
      }
      const message = error instanceof Error ? error.message : 'unknown';
      return PbmsResponseDto.fail(`Lỗi xóa loại phương tiện: ${message}`, 500);
    }
  }

  private map(item: { id: string; typeName: string; dimensions: string | null }) {
    return {
      vehicleTypeId: item.id,
      typeName: item.typeName,
      dimensions: item.dimensions,
    };
  }
}
