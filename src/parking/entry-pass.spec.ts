import { Test, TestingModule } from '@nestjs/testing';
import { entryPassPayload, parseEntryPassPayload } from '../common/entry-pass';
import { PayosService } from '../integrations/payos-files.service';
import { PlateRecognizerService } from '../integrations/plate-recognizer.service';
import { PaymentsService } from '../payments/payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { WalletsService } from '../wallets/wallets.service';
import { EntryPassesService } from './entry-passes.service';
import { ParkingOperationsService } from './parking-operations.service';
import { ParkingSessionsService } from './parking-sessions.service';

const userId = '0b6f3c6e-6a64-4c1c-9d5a-2b9c7f3f1a11';
const vehicleId = '6e2c1c43-5d8a-4b7e-9a39-0f6c4f2d8b22';
const passId = '5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c11';
const gateId = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const vehicle = {
  id: vehicleId,
  userId,
  vehicleTypeId: '660e8400-e29b-41d4-a716-446655440000',
  licensePlate: '51H12345',
};

describe('payload mã vào bãi', () => {
  it('tạo và đọc lại đúng mã', () => {
    expect(parseEntryPassPayload(entryPassPayload(passId, 'AB23CD'))).toEqual({ passId, code: 'AB23CD' });
  });

  it('bỏ qua payload khác (vé thường, mã ra cổng)', () => {
    expect(parseEntryPassPayload(passId)).toBeNull();
    expect(parseEntryPassPayload(`PBMS-EXIT:${passId}:AB23CD`)).toBeNull();
  });
});

describe('EntryPassesService', () => {
  let service: EntryPassesService;
  let prisma: Record<string, unknown> & {
    vehicle: { findFirst: jest.Mock };
    parkingSession: { findFirst: jest.Mock };
    entryPass: { updateMany: jest.Mock; create: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      vehicle: { findFirst: jest.fn().mockResolvedValue(vehicle) },
      parkingSession: { findFirst: jest.fn().mockResolvedValue(null) },
      entryPass: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn(({ data }) =>
          Promise.resolve({
            id: passId,
            ...data,
            status: 'Active',
            createdAt: new Date(),
            usedAt: null,
            sessionId: null,
            vehicle: { ...vehicle, nickname: null, vehicleType: { typeName: 'Ô tô' } },
          }),
        ),
      },
    };
    prisma.$transaction = jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn(prisma));
    const module: TestingModule = await Test.createTestingModule({
      providers: [EntryPassesService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(EntryPassesService);
  });

  it('tạo mã 24 giờ, huỷ mã cũ của cùng xe, trả QR', async () => {
    const before = Date.now();
    const res = await service.create(userId, { vehicleId });
    expect(res.isSuccess).toBe(true);
    expect(prisma.entryPass.updateMany.mock.calls[0][0]).toEqual({
      where: { vehicleId, status: 'Active' },
      data: { status: 'Cancelled' },
    });
    const data = prisma.entryPass.create.mock.calls[0][0].data;
    expect(data.code).toMatch(/^[A-Z2-9]{6}$/);
    expect(data.expiresAt.getTime() - before).toBeGreaterThanOrEqual(24 * 36e5 - 1000);
    expect((res.result as { qrPayload: string }).qrPayload).toBe(entryPassPayload(passId, data.code));
  });

  it('xe đang trong bãi thì không tạo mã', async () => {
    prisma.parkingSession.findFirst.mockResolvedValue({ id: 's1' });
    const res = await service.create(userId, { vehicleId });
    expect(res.statusCode).toBe(409);
    expect(prisma.entryPass.create).not.toHaveBeenCalled();
  });
});

describe('Check-in bằng mã vào bãi', () => {
  let ops: ParkingOperationsService;
  let prisma: {
    gate: { findUnique: jest.Mock };
    floor: { findUnique: jest.Mock };
    entryPass: { findUnique: jest.Mock; updateMany: jest.Mock; update: jest.Mock };
    monthlySubscription: { findFirst: jest.Mock };
    parkingSession: { findFirst: jest.Mock; create: jest.Mock; findUnique: jest.Mock };
    parkingSlot: { findFirst: jest.Mock; update: jest.Mock };
  };
  const pass = (over: Record<string, unknown> = {}) => ({
    id: passId,
    code: 'AB23CD',
    status: 'Active',
    expiresAt: new Date(Date.now() + 36e5),
    vehicleId,
    sessionId: null,
    vehicle,
    ...over,
  });

  beforeEach(async () => {
    prisma = {
      gate: {
        findUnique: jest.fn().mockResolvedValue({ id: gateId, gateType: 'Entry', floorId: 'f1', floor: { parkingId: 'p1' } }),
      },
      floor: { findUnique: jest.fn().mockResolvedValue({ parkingId: 'p1' }) },
      entryPass: {
        findUnique: jest.fn().mockResolvedValue(pass()),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      monthlySubscription: { findFirst: jest.fn().mockResolvedValue(null) },
      parkingSession: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'sess-1', licensePlateIn: '51H12345', entryTime: new Date() }),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      parkingSlot: {
        findFirst: jest.fn().mockResolvedValue({ id: 'slot-1' }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ParkingOperationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: PayosService, useValue: {} },
        { provide: PlateRecognizerService, useValue: {} },
        { provide: ParkingSessionsService, useValue: {} },
        { provide: PaymentsService, useValue: {} },
        { provide: WalletsService, useValue: {} },
      ],
    }).compile();
    ops = module.get(ParkingOperationsService);
  });

  const scan = (extra: Record<string, unknown> = {}) =>
    ops.checkIn({ gateId, qrPayload: entryPassPayload(passId, 'AB23CD'), ...extra });

  it('vào bãi bằng mã, đánh dấu đã dùng và gắn phiên', async () => {
    const res = await scan();
    expect(res.statusCode).toBe(201);
    expect(prisma.entryPass.updateMany.mock.calls[0][0].where).toMatchObject({ id: passId, status: 'Active' });
    expect(prisma.parkingSession.create.mock.calls[0][0].data).toMatchObject({
      licensePlateIn: '51H12345',
      vehicleId,
    });
    expect(prisma.entryPass.update).toHaveBeenCalledWith({ where: { id: passId }, data: { sessionId: 'sess-1' } });
  });

  it('mã đã dùng thì không vào lần hai', async () => {
    prisma.entryPass.findUnique.mockResolvedValue(pass({ status: 'Used' }));
    const res = await scan();
    expect(res.statusCode).toBe(409);
    expect(res.message).toContain('đã được sử dụng');
    expect(prisma.parkingSession.create).not.toHaveBeenCalled();
  });

  it('mã quá hạn thì từ chối', async () => {
    prisma.entryPass.findUnique.mockResolvedValue(pass({ expiresAt: new Date(Date.now() - 1000) }));
    const res = await scan();
    expect(res.message).toContain('đã hết hạn');
  });

  it('sai mã ngắn thì coi như mã không hợp lệ', async () => {
    prisma.entryPass.findUnique.mockResolvedValue(pass({ code: 'ZZZZZZ' }));
    const res = await scan();
    expect(res.statusCode).toBe(404);
  });

  it('biển số camera đọc khác biển trên mã thì từ chối', async () => {
    const res = await scan({ licensePlate: '30A99999' });
    expect(res.statusCode).toBe(409);
    expect(res.message).toContain('không khớp');
    expect(prisma.entryPass.updateMany).not.toHaveBeenCalled();
  });

  it('hai lần quét cùng lúc: lần thứ hai không chiếm được mã', async () => {
    prisma.entryPass.updateMany.mockResolvedValue({ count: 0 });
    const res = await scan();
    expect(res.statusCode).toBe(409);
    expect(prisma.parkingSession.create).not.toHaveBeenCalled();
  });
});
