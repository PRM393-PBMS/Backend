import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateParkingDto, UpdateParkingDto } from './dto/parking.dto';

const parkingSelect = {
  id: true,
  name: true,
  location: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ParkingSelect;

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
        },
        select: parkingSelect,
      }),
    );
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
