import { entryPassPayload } from '../common/entry-pass';
import { PayosService } from '../integrations/payos-files.service';
import { PlateRecognizerService } from '../integrations/plate-recognizer.service';
import { PaymentsService } from '../payments/payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReservationsService } from '../reservations/reservations.service';
import { WalletsService } from '../wallets/wallets.service';
import { ParkingOperationsService } from './parking-operations.service';
import { ParkingSessionsService } from './parking-sessions.service';

const gateId = '11111111-2222-4333-8444-555555555555';
const vehicleTypeId = '22222222-2222-4333-8444-555555555555';
const vehicleId = '33333333-2222-4333-8444-555555555555';
const passId = '44444444-2222-4333-8444-555555555555';

function setup(typeName = 'Xe máy điện', isResident = false) {
  const vehicle = {
    id: vehicleId,
    vehicleTypeId,
    licensePlate: '59A12345',
    vehicleType: { typeName },
  };
  const floor = {
    id: 'floor-1',
    parkingId: 'parking-1',
    floorName: 'Khu xe máy',
    totalCapacity: 2,
    isResident,
    dedicatedVehicleType: { id: 'bike', typeName: 'Xe máy' },
  };
  const prisma = {
    gate: {
      findUnique: jest
        .fn()
        .mockResolvedValue({
          id: gateId,
          floorId: floor.id,
          gateType: 'Entry',
        }),
    },
    floor: {
      findUnique: jest.fn().mockResolvedValue(floor),
      findMany: jest.fn().mockResolvedValue([]),
    },
    vehicleType: {
      findUnique: jest.fn().mockResolvedValue({ id: vehicleTypeId, typeName }),
    },
    vehicle: { findFirst: jest.fn().mockResolvedValue(vehicle) },
    user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-1' }) },
    monthlySubscription: { findFirst: jest.fn().mockResolvedValue(null) },
    parkingSession: {
      findFirst: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(1),
      create: jest
        .fn()
        .mockResolvedValue({
          id: 'session-1',
          licensePlateIn: vehicle.licensePlate,
          entryTime: new Date(),
        }),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    parkingSlot: {
      findFirst: jest.fn().mockResolvedValue({ id: 'slot-1' }),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(10),
    },
    entryPass: {
      findUnique: jest
        .fn()
        .mockResolvedValue({
          id: passId,
          code: 'AB23CD',
          status: 'Active',
          expiresAt: new Date(Date.now() + 3600000),
          vehicle,
          vehicleId,
        }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({}),
    },
    reservation: { count: jest.fn().mockResolvedValue(0) },
    pricingPolicy: { findFirst: jest.fn().mockResolvedValue(null) },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((fn) => fn(prisma));
  const ops = new ParkingOperationsService(
    prisma as unknown as PrismaService,
    {} as PayosService,
    {} as PlateRecognizerService,
    {} as ParkingSessionsService,
    {} as PaymentsService,
    {} as WalletsService,
  );
  const checkIn = () =>
    ops.checkIn({
      gateId,
      vehicleTypeId,
      licensePlate: vehicle.licensePlate,
      customerType: isResident ? 'Resident' : 'Guest',
    });
  const scan = () =>
    ops.checkIn({ gateId, qrPayload: entryPassPayload(passId, 'AB23CD') });
  return { prisma, ops, vehicle, floor, checkIn, scan };
}

describe('vehicle parking rules', () => {
  it.each(['Xe máy', 'Xe máy điện', 'Xe đạp điện'])(
    '%s enters without a numbered slot',
    async (type) => {
      const { prisma, checkIn } = setup(type);
      expect((await checkIn()).statusCode).toBe(201);
      expect(prisma.parkingSession.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            assignedSlotId: null,
            actualSlotId: null,
          }),
        }),
      );
      expect(prisma.parkingSlot.findFirst).not.toHaveBeenCalled();
      expect(prisma.parkingSlot.update).not.toHaveBeenCalled();
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects entry when free parking is full', async () => {
    const { prisma, checkIn } = setup();
    prisma.parkingSession.count.mockResolvedValue(2);
    expect((await checkIn()).statusCode).toBe(409);
    expect(prisma.parkingSession.create).not.toHaveBeenCalled();
  });

  it('rechecks capacity inside the transaction before consuming an entry pass', async () => {
    const { prisma, scan } = setup();
    prisma.parkingSession.count
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2);
    expect((await scan()).statusCode).toBe(409);
    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(prisma.entryPass.updateMany).not.toHaveBeenCalled();
    expect(prisma.parkingSession.create).not.toHaveBeenCalled();
  });

  it('consumes a motorbike entry pass and creates a session without a slot', async () => {
    const { prisma, scan } = setup();
    expect((await scan()).statusCode).toBe(201);
    expect(prisma.entryPass.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.entryPass.update).toHaveBeenCalledWith({
      where: { id: passId },
      data: { sessionId: 'session-1' },
    });
    expect(prisma.parkingSlot.update).not.toHaveBeenCalled();
  });

  it('does not create a second session when another scan has claimed the pass', async () => {
    const { prisma, scan } = setup();
    prisma.entryPass.updateMany.mockResolvedValue({ count: 0 });
    expect((await scan()).statusCode).toBe(409);
    expect(prisma.parkingSession.create).not.toHaveBeenCalled();
  });

  it('rejects motorbikes at a car floor', async () => {
    const { floor, prisma, checkIn } = setup();
    floor.dedicatedVehicleType.typeName = 'Ô tô';
    expect((await checkIn()).statusCode).toBe(409);
    expect(prisma.parkingSession.create).not.toHaveBeenCalled();
  });

  it.each(['Ô tô', 'Ô tô điện'])(
    '%s gets an occupied numbered slot',
    async (type) => {
      const { prisma, checkIn } = setup(type);
      expect((await checkIn()).statusCode).toBe(201);
      expect(prisma.parkingSession.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            assignedSlotId: 'slot-1',
            actualSlotId: 'slot-1',
          }),
        }),
      );
      expect(prisma.parkingSlot.update).toHaveBeenCalledWith({
        where: { id: 'slot-1' },
        data: { status: 'Occupied' },
      });
    },
  );

  it('does not allocate a car slot in another parking lot', async () => {
    const { prisma, checkIn } = setup('Ô tô điện');
    prisma.parkingSlot.findFirst.mockResolvedValue(null);
    expect((await checkIn()).statusCode).toBe(409);
    expect(prisma.parkingSlot.findFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ parkingId: 'parking-1' }),
      }),
    );
    expect(prisma.parkingSession.create).not.toHaveBeenCalled();
  });

  it.each(['Xe máy điện', 'Ô tô điện'])(
    'resident %s follows its slot rule',
    async (type) => {
      const { prisma, vehicle, checkIn } = setup(type, true);
      prisma.monthlySubscription.findFirst.mockResolvedValue({
        vehicle,
        fixedSlotId: type === 'Ô tô điện' ? 'fixed-1' : null,
      });
      expect((await checkIn()).statusCode).toBe(201);
      expect(prisma.parkingSession.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            actualSlotId: type === 'Ô tô điện' ? 'fixed-1' : null,
          }),
        }),
      );
    },
  );

  it('rejects a resident car without an assigned slot', async () => {
    const { prisma, vehicle, checkIn } = setup('Ô tô điện', true);
    prisma.monthlySubscription.findFirst.mockResolvedValue({
      vehicle,
      fixedSlotId: null,
    });
    expect((await checkIn()).statusCode).toBe(409);
    expect(prisma.parkingSession.create).not.toHaveBeenCalled();
  });

  it.each(['Ô tô', 'Ô tô điện', 'Xe máy điện'])(
    'reservation eligibility for %s',
    async (type) => {
      const { prisma } = setup(type);
      const service = new ReservationsService(
        prisma as unknown as PrismaService,
        {} as PayosService,
      );
      const result = await service.create('user-1', {
        vehicleId,
        expectedEntryTime: new Date(Date.now() + 3600000).toISOString(),
      });
      if (type === 'Xe máy điện') {
        expect(result.message).toContain('chỉ áp dụng');
        expect(prisma.parkingSlot.count).not.toHaveBeenCalled();
      } else {
        expect(prisma.parkingSlot.count).toHaveBeenCalled();
        expect(prisma.pricingPolicy.findFirst).toHaveBeenCalled();
        expect(result.message).toContain('chính sách giá');
      }
    },
  );

  it('reports shared motorbike capacity instead of numbered slots', async () => {
    const { prisma, floor, ops } = setup();
    prisma.floor.findMany.mockResolvedValue([
      { ...floor, gates: [{ _count: { entrySessions: 1 } }] },
    ]);
    const result = await ops.availability(vehicleTypeId);
    expect(result.result).toEqual([
      expect.objectContaining({
        vehicleTypeId,
        totalSlots: 2,
        availableSlots: 1,
        occupiedSlots: 1,
        assignedSlots: 0,
      }),
    ]);
  });
});
