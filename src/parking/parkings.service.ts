import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateParkingDto, UpdateParkingDto } from './dto/parking.dto';
import { isMotorbikeType } from '../common/license-plate';
import { freeParkingAvailability } from '../common/free-parking-availability';

const parkingSelect = {
  id: true,
  name: true,
  location: true,
  latitude: true,
  longitude: true,
  imageUrl: true,
  openingHours: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ParkingSelect;

/** Chuỗi rỗng coi như xoá giá trị. */
const optionalText = (value: string | null | undefined) => {
  const v = value?.trim();
  return v ? v : null;
};

const slotSelect = {
  id: true,
  parkingId: true,
  floorId: true,
  slotCode: true,
  vehicleTypeId: true,
  status: true,
  assignedUserId: true,
} satisfies Prisma.ParkingSlotSelect;

@Injectable()
export class ParkingsService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateParkingDto) {
    return this.write(() =>
      this.prisma.parking.create({
        data: {
          name: dto.name.trim(),
          location: dto.location.trim(),
          latitude: dto.latitude ?? null,
          longitude: dto.longitude ?? null,
          imageUrl: optionalText(dto.imageUrl),
          openingHours: optionalText(dto.openingHours),
        },
        select: parkingSelect,
      }),
    );
  }

  /**
   * Danh sách bãi cho app khách hàng: toạ độ (nếu có) và chỗ trống theo loại xe,
   * đếm ô đỗ cho ô tô và sức chứa tầng cho khu xe máy đỗ tự do.
   */
  async listForCustomers() {
    const [parkings, counts, types, freeParking] = await Promise.all([
      this.prisma.parking.findMany({ select: parkingSelect, orderBy: [{ name: 'asc' }, { id: 'asc' }] }),
      this.prisma.parkingSlot.groupBy({
        by: ['parkingId', 'vehicleTypeId', 'status'],
        _count: { _all: true },
      }),
      this.prisma.vehicleType.findMany({ select: { id: true, typeName: true } }),
      freeParkingAvailability(this.prisma),
    ]);
    const typeName = new Map(types.map((t) => [t.id, t.typeName]));
    return parkings.map((p) => {
      const byType = new Map<string, { vehicleTypeId: string; vehicleTypeName: string; totalSlots: number; availableSlots: number }>();
      for (const c of counts.filter((c) => c.parkingId === p.id)) {
        if (isMotorbikeType(typeName.get(c.vehicleTypeId))) continue;
        const row = byType.get(c.vehicleTypeId) ?? {
          vehicleTypeId: c.vehicleTypeId,
          vehicleTypeName: typeName.get(c.vehicleTypeId) ?? '',
          totalSlots: 0,
          availableSlots: 0,
        };
        row.totalSlots += c._count._all;
        if (c.status.toLowerCase() === 'available') {
          row.availableSlots += c._count._all;
        }
        byType.set(c.vehicleTypeId, row);
      }
      for (const floor of freeParking.filter((f) => f.parkingId === p.id)) {
        const row = byType.get(floor.vehicleTypeId) ?? {
          vehicleTypeId: floor.vehicleTypeId,
          vehicleTypeName: floor.vehicleTypeName,
          totalSlots: 0,
          availableSlots: 0,
        };
        row.totalSlots += floor.totalSlots;
        row.availableSlots += floor.availableSlots;
        byType.set(floor.vehicleTypeId, row);
      }
      const availability = [...byType.values()];
      return {
        parkingId: p.id,
        name: p.name,
        location: p.location,
        latitude: p.latitude,
        longitude: p.longitude,
        imageUrl: p.imageUrl,
        openingHours: p.openingHours,
        totalSlots: availability.reduce((s, a) => s + a.totalSlots, 0),
        availableSlots: availability.reduce((s, a) => s + a.availableSlots, 0),
        availability,
      };
    });
  }

  findAll() {
    return this.prisma.parking.findMany({
      select: parkingSelect,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
  }

  async findOne(id: string) {
    const parking = await this.prisma.parking.findUnique({
      where: { id },
      select: parkingSelect,
    });
    if (!parking) {
      throw new NotFoundException('Không tìm thấy bãi đỗ');
    }
    return parking;
  }

  async update(id: string, dto: UpdateParkingDto) {
    await this.findOne(id);
    const data: Prisma.ParkingUpdateInput = {};
    if (dto.name !== undefined) {
      data.name = dto.name.trim();
    }
    if (dto.location !== undefined) {
      data.location = dto.location.trim();
    }
    if (dto.latitude !== undefined) {
      data.latitude = dto.latitude;
    }
    if (dto.longitude !== undefined) {
      data.longitude = dto.longitude;
    }
    if (dto.imageUrl !== undefined) {
      data.imageUrl = optionalText(dto.imageUrl);
    }
    if (dto.openingHours !== undefined) {
      data.openingHours = optionalText(dto.openingHours);
    }
    if (Object.keys(data).length === 0) {
      return this.findOne(id);
    }
    return this.write(() =>
      this.prisma.parking.update({
        where: { id },
        data,
        select: parkingSelect,
      }),
    );
  }

  async remove(id: string) {
    const parking = await this.prisma.parking.findUnique({
      where: { id },
      select: { id: true, _count: { select: { floors: true, slots: true } } },
    });
    if (!parking) {
      throw new NotFoundException('Không tìm thấy bãi đỗ');
    }
    if (parking._count.floors > 0 || parking._count.slots > 0) {
      throw new ConflictException('Không thể xóa bãi đỗ còn tầng hoặc ô đỗ');
    }
    try {
      return await this.prisma.parking.delete({
        where: { id },
        select: parkingSelect,
      });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new ConflictException('Không thể xóa bãi đỗ còn tầng hoặc ô đỗ');
      }
      throw error;
    }
  }

  async findSlots(id: string) {
    await this.findOne(id);
    return this.prisma.parkingSlot.findMany({
      where: { parkingId: id },
      select: slotSelect,
      orderBy: [{ slotCode: 'asc' }, { id: 'asc' }],
    });
  }

  private async write<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Tên bãi đỗ đã tồn tại');
      }
      throw error;
    }
  }
}
