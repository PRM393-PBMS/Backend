import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PayosService } from '../integrations/payos-files.service';
import { PrismaService } from '../prisma/prisma.service';
import { WalletsService } from '../wallets/wallets.service';
import { ContractsService } from './contracts.service';
import { MonthlySubscriptionsService } from './monthly-subscriptions.service';

describe('Vé tháng theo bãi', () => {
  const userId = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
  const lotA = 'c56a4180-65aa-42ec-a945-5fd21dec0538';
  const lotB = 'd67b5291-76bb-43fd-b056-6ae32eed1649';
  const vehicle = {
    id: 'a52c7c13-5f2c-47ce-aeb2-1da63a5f9c68',
    userId,
    vehicleTypeId: '550e8400-e29b-41d4-a716-446655440000',
    licensePlate: '59A12345',
    vehicleType: { typeName: 'Xe máy' },
  };
  const basePkg = {
    id: '1b4e28ba-2fa1-11d2-883f-0016d3cca427',
    vehicleTypeId: vehicle.vehicleTypeId,
    price: new Prisma.Decimal(300000),
    durationMonths: 1,
    durationDays: 30,
    status: 'Active',
    requireFixedSlot: false,
    allParkings: false,
    vehicleType: { typeName: 'Xe máy' },
  };

  let service: MonthlySubscriptionsService;
  let prisma: Record<string, Record<string, jest.Mock> | jest.Mock>;
  let create: jest.Mock;

  async function build(pkg: typeof basePkg, lots: string[]) {
    create = jest.fn().mockResolvedValue({ id: 'sub-1', userId, price: pkg.price, status: 'PendingPayment' });
    prisma = {
      subscriptionPackage: { findUnique: jest.fn().mockResolvedValue(pkg) },
      vehicle: { findFirst: jest.fn().mockResolvedValue(vehicle) },
      monthlySubscription: { findFirst: jest.fn().mockResolvedValue(null), create },
      parking: {
        findMany: jest.fn().mockResolvedValue(lots.map((id) => ({ id }))),
        findUnique: jest.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve(lots.includes(where.id) ? { id: where.id } : null),
        ),
      },
      parkingSlot: { findUnique: jest.fn(), count: jest.fn().mockResolvedValue(5) },
      payment: { create: jest.fn().mockResolvedValue({ id: 'pay-1', amount: pkg.price }), update: jest.fn() },
      $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MonthlySubscriptionsService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: PayosService,
          useValue: { createPaymentLink: jest.fn().mockResolvedValue({ orderCode: '1', paymentUrl: 'u', paymentLinkId: 'l' }) },
        },
        { provide: WalletsService, useValue: {} },
        { provide: ContractsService, useValue: { createForSubscription: jest.fn() } },
      ],
    }).compile();
    service = module.get(MonthlySubscriptionsService);
  }

  it('nhiều bãi thì bắt buộc chọn bãi', async () => {
    await build(basePkg, [lotA, lotB]);
    const res = await service.register(userId, { packageId: basePkg.id, vehicleId: vehicle.id }, true);
    expect(res.isSuccess).toBe(false);
    expect(res.message).toBe('Vui lòng chọn bãi đỗ áp dụng vé tháng');
    expect(create).not.toHaveBeenCalled();
  });

  it('gắn vé vào bãi khách chọn', async () => {
    await build(basePkg, [lotA, lotB]);
    await service.register(userId, { packageId: basePkg.id, vehicleId: vehicle.id, parkingId: lotB }, true);
    expect(create.mock.calls[0][0].data.parkingId).toBe(lotB);
  });

  it('gói mọi bãi không gắn bãi nào', async () => {
    await build({ ...basePkg, allParkings: true }, [lotA, lotB]);
    await service.register(userId, { packageId: basePkg.id, vehicleId: vehicle.id }, true);
    expect(create.mock.calls[0][0].data.parkingId).toBeNull();
  });

  it('bãi không tồn tại thì báo 404', async () => {
    await build(basePkg, [lotA]);
    const res = await service.register(
      userId,
      { packageId: basePkg.id, vehicleId: vehicle.id, parkingId: lotB },
      true,
    );
    expect(res.statusCode).toBe(404);
  });
});
