import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import { errorMessage, isEmptyGuid, pbmsPick, pbmsPickGuid } from '../common/pbms-fields';

const SLOT_STATUSES = ['Available', 'Occupied', 'Assigned', 'Maintenance', 'Locked'];

@Injectable()
export class ParkingSlotsService {
  constructor(private readonly prisma: PrismaService) {}

  async getAll(): Promise<PbmsResponseDto> {
    const slots = await this.prisma.parkingSlot.findMany({
      include: { floor: true, vehicleType: true },
      orderBy: { slotCode: 'asc' },
    });
    if (slots.length === 0) {
      return PbmsResponseDto.fail('Không tìm thấy ô đỗ nào', 404);
    }
    return PbmsResponseDto.ok('Lấy danh sách ô đỗ thành công', slots.map((s) => this.map(s)));
  }

  async getById(id: string): Promise<PbmsResponseDto> {
    if (isEmptyGuid(id)) {
      return PbmsResponseDto.fail('Vui lòng nhập ParkingSlotId');
    }
    const slot = await this.prisma.parkingSlot.findUnique({
      where: { id },
      include: { floor: true, vehicleType: true },
    });
    if (!slot) {
      return PbmsResponseDto.fail('Không tìm thấy ô đỗ', 404);
    }
    return PbmsResponseDto.ok('Lấy thông tin ô đỗ thành công', this.map(slot));
  }

  async create(dto: object): Promise<PbmsResponseDto> {
    const floorId = pbmsPickGuid(dto, 'floorId', 'FloorId');
    const vehicleTypeId = pbmsPickGuid(dto, 'vehicleTypeId', 'VehicleTypeId');
    const slotCode = pbmsPick(dto, 'slotCode', 'SlotCode').trim();
    if (isEmptyGuid(floorId) || isEmptyGuid(vehicleTypeId) || !slotCode) {
      return PbmsResponseDto.fail('Dữ liệu không hợp lệ');
    }
    const refs = await this.validateRefs(floorId, vehicleTypeId, slotCode, null);
    if (refs.error) {
      return refs.error;
    }
    try {
      const slot = await this.prisma.parkingSlot.create({
        data: {
          floorId,
          vehicleTypeId,
          slotCode,
          status: this.normalizeStatus(pbmsPick(dto, 'status', 'Status')) || 'Available',
        },
        include: { floor: true, vehicleType: true },
      });
      return PbmsResponseDto.ok('Tạo ô đỗ thành công', this.map(slot), 201);
    } catch (error: unknown) {
      return PbmsResponseDto.fail(`Lỗi tạo ô đỗ: ${errorMessage(error)}`, 500);
    }
  }

  async update(dto: object): Promise<PbmsResponseDto> {
    const id = pbmsPickGuid(dto, 'slotId', 'SlotId', 'parkingSlotId', 'ParkingSlotId');
    if (isEmptyGuid(id)) {
      return PbmsResponseDto.fail('Dữ liệu cập nhật không hợp lệ');
    }
    const existing = await this.prisma.parkingSlot.findUnique({ where: { id } });
    if (!existing) {
      return PbmsResponseDto.fail('Không tìm thấy ô đỗ', 404);
    }
    const floorId = pbmsPickGuid(dto, 'floorId', 'FloorId') || existing.floorId;
    const vehicleTypeId = pbmsPickGuid(dto, 'vehicleTypeId', 'VehicleTypeId') || existing.vehicleTypeId;
    const slotCode = pbmsPick(dto, 'slotCode', 'SlotCode').trim() || existing.slotCode;
    const refs = await this.validateRefs(floorId, vehicleTypeId, slotCode, id);
    if (refs.error) {
      return refs.error;
    }
    try {
      const slot = await this.prisma.parkingSlot.update({
        where: { id },
        data: {
          floorId,
          vehicleTypeId,
          slotCode,
          status: this.normalizeStatus(pbmsPick(dto, 'status', 'Status')) || existing.status,
        },
        include: { floor: true, vehicleType: true },
      });
      return PbmsResponseDto.ok('Cập nhật ô đỗ thành công', this.map(slot));
    } catch (error: unknown) {
      return PbmsResponseDto.fail(`Lỗi cập nhật ô đỗ: ${errorMessage(error)}`, 500);
    }
  }

  async updateStatus(id: string, dto: object): Promise<PbmsResponseDto> {
    if (isEmptyGuid(id)) {
      return PbmsResponseDto.fail('Vui lòng nhập ParkingSlotId');
    }
    const status = this.normalizeStatus(pbmsPick(dto, 'status', 'Status'));
    if (!status) {
      return PbmsResponseDto.fail('Trạng thái ô đỗ không hợp lệ');
    }
    const existing = await this.prisma.parkingSlot.findUnique({
      where: { id },
      include: { floor: true, vehicleType: true },
    });
    if (!existing) {
      return PbmsResponseDto.fail('Không tìm thấy ô đỗ', 404);
    }
    const slot = await this.prisma.parkingSlot.update({
      where: { id },
      data: { status },
      include: { floor: true, vehicleType: true },
    });
    return PbmsResponseDto.ok('Cập nhật trạng thái ô đỗ thành công', this.map(slot));
  }

  async remove(id: string): Promise<PbmsResponseDto> {
    if (isEmptyGuid(id)) {
      return PbmsResponseDto.fail('Vui lòng nhập ParkingSlotId');
    }
    const existing = await this.prisma.parkingSlot.findUnique({ where: { id } });
    if (!existing) {
      return PbmsResponseDto.fail('Không tìm thấy ô đỗ', 404);
    }
    try {
      await this.prisma.parkingSlot.delete({ where: { id } });
      return PbmsResponseDto.ok('Xóa ô đỗ thành công');
    } catch (error: unknown) {
      return PbmsResponseDto.fail(`Lỗi xóa ô đỗ: ${errorMessage(error)}`, 500);
    }
  }

  private normalizeStatus(value: string): string {
    const match = SLOT_STATUSES.find((item) => item.toLowerCase() === value.trim().toLowerCase());
    return match ?? '';
  }

  private async validateRefs(
    floorId: string,
    vehicleTypeId: string,
    slotCode: string,
    currentId: string | null,
  ) {
    const floor = await this.prisma.floor.findUnique({ where: { id: floorId } });
    if (!floor) {
      return { error: PbmsResponseDto.fail('Tầng không tồn tại') };
    }
    const vehicleType = await this.prisma.vehicleType.findUnique({ where: { id: vehicleTypeId } });
    if (!vehicleType) {
      return { error: PbmsResponseDto.fail('Loại phương tiện không tồn tại') };
    }
    const dup = await this.prisma.parkingSlot.findFirst({
      where: {
        slotCode: { equals: slotCode, mode: 'insensitive' },
        ...(currentId ? { NOT: { id: currentId } } : {}),
      },
    });
    if (dup) {
      return { error: PbmsResponseDto.fail('Mã ô đỗ đã tồn tại') };
    }
    return { error: null };
  }

  private map(slot: {
    id: string;
    floorId: string;
    vehicleTypeId: string;
    slotCode: string;
    status: string;
    floor: { floorName: string; isResident: boolean };
    vehicleType: { typeName: string };
  }) {
    return {
      slotId: slot.id,
      floorId: slot.floorId,
      floorName: slot.floor.floorName,
      slotCode: slot.slotCode,
      vehicleTypeId: slot.vehicleTypeId,
      vehicleTypeName: slot.vehicleType.typeName,
      status: slot.status,
      isResident: slot.floor.isResident,
    };
  }
}
