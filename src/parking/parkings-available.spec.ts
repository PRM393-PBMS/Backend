import { PrismaService } from '../prisma/prisma.service';
import { ParkingsService } from './parkings.service';

describe('ParkingsService.listForCustomers', () => {
  it('đếm tổng và chỗ trống theo từng bãi, từng loại xe; giữ toạ độ null', async () => {
    const prisma = {
      floor: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'bike-floor',
            parkingId: 'p1',
            floorName: 'Khu xe máy',
            totalCapacity: 10,
            dedicatedVehicleType: { id: 'bike', typeName: 'Xe máy' },
            gates: [],
          },
        ]),
      },
      parking: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'p1',
            name: 'Bãi A',
            location: 'Q1',
            latitude: 10.77,
            longitude: 106.7,
          },
          {
            id: 'p2',
            name: 'Bãi B',
            location: 'N/A',
            latitude: null,
            longitude: null,
          },
        ]),
      },
      parkingSlot: {
        groupBy: jest.fn().mockResolvedValue([
          {
            parkingId: 'p1',
            vehicleTypeId: 'car',
            status: 'Available',
            _count: { _all: 3 },
          },
          {
            parkingId: 'p1',
            vehicleTypeId: 'car',
            status: 'Occupied',
            _count: { _all: 2 },
          },
          {
            parkingId: 'p1',
            vehicleTypeId: 'bike',
            status: 'Available',
            _count: { _all: 10 },
          },
          {
            parkingId: 'p2',
            vehicleTypeId: 'car',
            status: 'Assigned',
            _count: { _all: 4 },
          },
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

    expect(a).toMatchObject({
      parkingId: 'p1',
      latitude: 10.77,
      totalSlots: 15,
      availableSlots: 13,
    });
    expect(a.availability).toEqual([
      {
        vehicleTypeId: 'car',
        vehicleTypeName: 'Ô tô',
        totalSlots: 5,
        availableSlots: 3,
      },
      {
        vehicleTypeId: 'bike',
        vehicleTypeName: 'Xe máy',
        totalSlots: 10,
        availableSlots: 10,
      },
    ]);
    expect(b).toMatchObject({
      parkingId: 'p2',
      latitude: null,
      totalSlots: 4,
      availableSlots: 0,
    });
  });

  it.each([
    { sessions: [], available: 120 },
    { sessions: [2, 1], available: 117 },
    { sessions: [120], available: 0 },
    { sessions: [125], available: 0 },
  ])(
    'counts floor capacity without numbered slots: $available available',
    async ({ sessions, available }) => {
      const parkings = [
        { id: 'a5c99101-cb76-4996-b056-720308a8929e', name: 'Bãi xe Bitexco' },
        { id: '987feae6-5995-4a7a-80e4-dc5afad353ed', name: 'Bãi xe FPT' },
        {
          id: '8c58456c-d1d1-44cd-b949-96d516ae4aab',
          name: 'Bãi xe Landmark 81',
        },
        {
          id: 'fbed3285-235f-441e-ad00-0a357dcd375f',
          name: 'Bãi xe Saigon Centre',
        },
      ];
      const bike = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        typeName: 'Xe máy',
      };
      const prisma = {
        parking: { findMany: jest.fn().mockResolvedValue(parkings) },
        parkingSlot: { groupBy: jest.fn().mockResolvedValue([]) },
        vehicleType: { findMany: jest.fn().mockResolvedValue([bike]) },
        floor: {
          findMany: jest.fn().mockResolvedValue(
            parkings.map((p) => ({
              id: `floor-${p.id}`,
              parkingId: p.id,
              floorName: `${p.name} - Khu xe máy`,
              totalCapacity: 120,
              dedicatedVehicleType: bike,
              gates: sessions.map((count) => ({
                _count: { entrySessions: count },
              })),
            })),
          ),
        },
      };
      const result = await new ParkingsService(
        prisma as unknown as PrismaService,
      ).listForCustomers();
      expect(result).toEqual(
        parkings.map((p) =>
          expect.objectContaining({
            parkingId: p.id,
            totalSlots: 120,
            availableSlots: available,
            availability: [
              {
                vehicleTypeId: bike.id,
                vehicleTypeName: bike.typeName,
                totalSlots: 120,
                availableSlots: available,
              },
            ],
          }),
        ),
      );
    },
  );
});
