import { PrismaService } from '../prisma/prisma.service';
import { ParkingsService } from './parkings.service';

describe('ParkingsService.listForCustomers', () => {
  it('đếm tổng và chỗ trống theo từng bãi, từng loại xe; giữ toạ độ null', async () => {
    const prisma = {
      parking: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'p1', name: 'Bãi A', location: 'Q1', latitude: 10.77, longitude: 106.7 },
          { id: 'p2', name: 'Bãi B', location: 'N/A', latitude: null, longitude: null },
        ]),
      },
      parkingSlot: {
        groupBy: jest.fn().mockResolvedValue([
          { parkingId: 'p1', vehicleTypeId: 'car', status: 'Available', _count: { _all: 3 } },
          { parkingId: 'p1', vehicleTypeId: 'car', status: 'Occupied', _count: { _all: 2 } },
          { parkingId: 'p1', vehicleTypeId: 'bike', status: 'Available', _count: { _all: 10 } },
          { parkingId: 'p2', vehicleTypeId: 'car', status: 'Assigned', _count: { _all: 4 } },
        ]),
      },
      vehicleType: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'car', typeName: 'Ô tô' },
          { id: 'bike', typeName: 'Xe máy' },
        ]),
      },
    };
    const service = new ParkingsService(prisma as unknown as PrismaService);

    const [a, b] = await service.listForCustomers();

    expect(a).toMatchObject({ parkingId: 'p1', latitude: 10.77, totalSlots: 15, availableSlots: 13 });
    expect(a.availability).toEqual([
      { vehicleTypeId: 'car', vehicleTypeName: 'Ô tô', totalSlots: 5, availableSlots: 3 },
      { vehicleTypeId: 'bike', vehicleTypeName: 'Xe máy', totalSlots: 10, availableSlots: 10 },
    ]);
    expect(b).toMatchObject({ parkingId: 'p2', latitude: null, totalSlots: 4, availableSlots: 0 });
  });
});
