import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import { errorMessage, isEmptyGuid, pbmsPick, pbmsPickGuid } from '../common/pbms-fields';

@Injectable()
export class GatesService {
  constructor(private readonly prisma: PrismaService) {}

  async getAll(): Promise<PbmsResponseDto> {
    const gates = await this.prisma.gate.findMany({
      include: { floor: true },
      orderBy: { gateName: 'asc' },
    });
    if (gates.length === 0) {
      return PbmsResponseDto.fail('Không tìm thấy cổng nào', 404);
    }
    return PbmsResponseDto.ok('Lấy danh sách cổng thành công', gates.map((g) => this.map(g)));
  }

  async getById(id: string): Promise<PbmsResponseDto> {
    if (isEmptyGuid(id)) {
      return PbmsResponseDto.fail('Vui lòng nhập GateId');
    }
    const gate = await this.prisma.gate.findUnique({ where: { id }, include: { floor: true } });
    if (!gate) {
      return PbmsResponseDto.fail('Không tìm thấy cổng', 404);
    }
    return PbmsResponseDto.ok('Lấy thông tin cổng thành công', this.map(gate));
  }

  async create(dto: object): Promise<PbmsResponseDto> {
    const floorId = pbmsPickGuid(dto, 'floorId', 'FloorId');
    const gateName = pbmsPick(dto, 'gateName', 'GateName').trim();
    const gateType = this.normalizeGateType(pbmsPick(dto, 'gateType', 'GateType'));
    if (isEmptyGuid(floorId) || !gateName || !gateType) {
      return PbmsResponseDto.fail('Dữ liệu không hợp lệ');
    }
    const floor = await this.prisma.floor.findUnique({ where: { id: floorId } });
    if (!floor) {
      return PbmsResponseDto.fail('Tầng không tồn tại');
    }
    try {
      const gate = await this.prisma.gate.create({
        data: { floorId, gateName, gateType },
        include: { floor: true },
      });
      return PbmsResponseDto.ok('Tạo cổng thành công', this.map(gate), 201);
    } catch (error: unknown) {
      return PbmsResponseDto.fail(`Lỗi tạo cổng: ${errorMessage(error)}`, 500);
    }
  }

  async update(dto: object): Promise<PbmsResponseDto> {
    const id = pbmsPickGuid(dto, 'gateId', 'GateId');
    if (isEmptyGuid(id)) {
      return PbmsResponseDto.fail('Dữ liệu cập nhật không hợp lệ');
    }
    const existing = await this.prisma.gate.findUnique({ where: { id } });
    if (!existing) {
      return PbmsResponseDto.fail('Không tìm thấy cổng', 404);
    }
    const floorId = pbmsPickGuid(dto, 'floorId', 'FloorId') || existing.floorId;
    const floor = await this.prisma.floor.findUnique({ where: { id: floorId } });
    if (!floor) {
      return PbmsResponseDto.fail('Tầng không tồn tại');
    }
    const gateType =
      this.normalizeGateType(pbmsPick(dto, 'gateType', 'GateType')) || existing.gateType;
    try {
      const gate = await this.prisma.gate.update({
        where: { id },
        data: {
          floorId,
          gateName: pbmsPick(dto, 'gateName', 'GateName').trim() || existing.gateName,
          gateType,
        },
        include: { floor: true },
      });
      return PbmsResponseDto.ok('Cập nhật cổng thành công', this.map(gate));
    } catch (error: unknown) {
      return PbmsResponseDto.fail(`Lỗi cập nhật cổng: ${errorMessage(error)}`, 500);
    }
  }

  async remove(id: string): Promise<PbmsResponseDto> {
    if (isEmptyGuid(id)) {
      return PbmsResponseDto.fail('Vui lòng nhập GateId');
    }
    const existing = await this.prisma.gate.findUnique({ where: { id } });
    if (!existing) {
      return PbmsResponseDto.fail('Không tìm thấy cổng', 404);
    }
    try {
      await this.prisma.gate.delete({ where: { id } });
      return PbmsResponseDto.ok('Xóa cổng thành công');
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        return PbmsResponseDto.fail(`Lỗi xóa cổng: ${error.message}`, 500);
      }
      return PbmsResponseDto.fail(`Lỗi xóa cổng: ${errorMessage(error)}`, 500);
    }
  }

  private normalizeGateType(value: string): string {
    const trimmed = value.trim();
    if (/^entry$/i.test(trimmed)) {
      return 'Entry';
    }
    if (/^exit$/i.test(trimmed)) {
      return 'Exit';
    }
    return '';
  }

  private map(gate: {
    id: string;
    floorId: string;
    floor: { floorName: string };
    gateName: string;
    gateType: string;
  }) {
    return {
      gateId: gate.id,
      gateName: gate.gateName,
      gateType: gate.gateType,
      floorId: gate.floorId,
      floorName: gate.floor.floorName,
    };
  }
}
