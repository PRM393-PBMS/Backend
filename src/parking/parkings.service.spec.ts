import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ParkingsService } from './parkings.service';

describe('ParkingsService', () => {
  const parkingId = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
  let service: ParkingsService;
  let prisma: {
    parking: {
      create: jest.Mock;
      findUnique: jest.Mock;
      delete: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      parking: {
        create: jest.fn(),
        findUnique: jest.fn(),
        delete: jest.fn(),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ParkingsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(ParkingsService);
  });

  it('rejects a duplicate parking name with 409', async () => {
    prisma.parking.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '6.4.1',
      }),
    );

    await expect(
      service.create({ name: 'Default Parking', location: 'N/A' }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.create({ name: 'Default Parking', location: 'N/A' }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('rejects deleting a parking that still has slots with 409', async () => {
    prisma.parking.findUnique.mockResolvedValue({
      id: parkingId,
      _count: { slots: 2 },
    });

    await expect(service.remove(parkingId)).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(service.remove(parkingId)).rejects.toMatchObject({
      status: 409,
    });
    expect(prisma.parking.delete).not.toHaveBeenCalled();
  });

  it('deletes a parking that has no slots', async () => {
    const deleted = {
      id: parkingId,
      name: 'Empty lot',
      location: 'N/A',
      createdAt: new Date('2026-10-01T00:00:00.000Z'),
      updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    };
    prisma.parking.findUnique.mockResolvedValue({
      id: parkingId,
      _count: { slots: 0 },
    });
    prisma.parking.delete.mockResolvedValue(deleted);

    await expect(service.remove(parkingId)).resolves.toEqual(deleted);
    expect(prisma.parking.delete).toHaveBeenCalledWith({
      where: { id: parkingId },
      select: {
        id: true,
        name: true,
        location: true,
        latitude: true,
        longitude: true,
        imageUrl: true,
        openingHours: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  });

  it('returns 404 when the parking does not exist', async () => {
    prisma.parking.findUnique.mockResolvedValue(null);
    await expect(service.findOne(parkingId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
