import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PayosService } from '../integrations/payos-files.service';
import { InsufficientWalletFundsError, WalletsService } from '../wallets/wallets.service';
import { MonthlySubscriptionsService } from './monthly-subscriptions.service';

describe('MonthlySubscriptionsService register payment methods', () => {
  const userId = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
  const packageId = '1b4e28ba-2fa1-11d2-883f-0016d3cca427';
  const pkg = {
    id: packageId,
    vehicleTypeId: '550e8400-e29b-41d4-a716-446655440000',
    price: new Prisma.Decimal(300000),
    durationDays: 30,
    status: 'Active',
    requireFixedSlot: false,
    vehicleType: { typeName: 'Xe máy' },
  };

  let service: MonthlySubscriptionsService;
  let prisma: {
    subscriptionPackage: { findUnique: jest.Mock };
    monthlySubscription: { findFirst: jest.Mock; create: jest.Mock; update: jest.Mock };
    payment: { create: jest.Mock; update: jest.Mock };
    user: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  let payos: { createPaymentLink: jest.Mock };
  let wallets: { debitInTransaction: jest.Mock; getBalanceForUser: jest.Mock };

  beforeEach(async () => {
    prisma = {
      subscriptionPackage: { findUnique: jest.fn().mockResolvedValue(pkg) },
      monthlySubscription: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        update: jest.fn(),
      },
      payment: { create: jest.fn(), update: jest.fn() },
      user: { findUnique: jest.fn() },
      $transaction: jest.fn(),
    };
    payos = { createPaymentLink: jest.fn() };
    wallets = {
      debitInTransaction: jest.fn(),
      getBalanceForUser: jest.fn().mockResolvedValue({
        walletId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
        walletBalance: 10000,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MonthlySubscriptionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: PayosService, useValue: payos },
        { provide: WalletsService, useValue: wallets },
      ],
    }).compile();
    service = module.get(MonthlySubscriptionsService);
  });

  it('rejects an unsupported paymentMethod', async () => {
    const result = await service.register(
      userId,
      { packageId, licensePlate: '59A12345', paymentMethod: 'Cash' },
      true,
    );
    expect(result.isSuccess).toBe(false);
    expect(result.message).toBe('Phương thức thanh toán gói chỉ được là PayOS hoặc Wallet');
  });

  it('returns PayOS checkout fields when paymentMethod is omitted', async () => {
    prisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => Promise<unknown>) =>
      fn(prisma),
    );
    prisma.monthlySubscription.create.mockResolvedValue({
      id: 'sub-1',
      userId,
      licensePlate: '59A12345',
      startDate: new Date(),
      endDate: new Date(),
      price: pkg.price,
      status: 'PendingPayment',
    });
    prisma.payment.create.mockResolvedValue({
      id: 'pay-1',
      amount: pkg.price,
    });
    payos.createPaymentLink.mockResolvedValue({
      paymentUrl: 'https://pay.payos.vn/web/demo',
      paymentLinkId: 'plink_demo',
      orderCode: '1727',
    });

    const result = await service.register(userId, { packageId, licensePlate: '59A12345' }, true);

    expect(result.statusCode).toBe(201);
    expect(result.result).toEqual(
      expect.objectContaining({
        paymentMethod: 'PayOS',
        paymentUrl: 'https://pay.payos.vn/web/demo',
        status: 'PendingPayment',
      }),
    );
  });

  it('returns remaining balance details when the wallet cannot cover the package', async () => {
    prisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => Promise<unknown>) =>
      fn(prisma),
    );
    prisma.monthlySubscription.create.mockResolvedValue({
      id: 'sub-1',
      userId,
      vehicleTypeId: pkg.vehicleTypeId,
      fixedSlotId: null,
    });
    prisma.payment.create.mockResolvedValue({ id: 'pay-1', amount: pkg.price });
    wallets.debitInTransaction.mockRejectedValue(new InsufficientWalletFundsError());
    prisma.wallet = { findUnique: jest.fn() };
    prisma.wallet.findUnique.mockResolvedValue({
      id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
      balance: new Prisma.Decimal(10000),
    });

    const result = await service.register(
      userId,
      { packageId, licensePlate: '59A12345', paymentMethod: 'Wallet' },
      true,
    );

    expect(result.isSuccess).toBe(false);
    expect(result.statusCode).toBe(400);
    expect(result.message).toBe('Số dư ví không đủ để thanh toán gói này');
    expect(result.result).toEqual({
      paymentMethod: 'Wallet',
      walletId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
      walletBalance: 10000,
      amount: 300000,
    });
    expect(payos.createPaymentLink).not.toHaveBeenCalled();
  });

  it('activates the subscription from wallet without creating a PayOS link', async () => {
    prisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => Promise<unknown>) =>
      fn(prisma),
    );
    prisma.monthlySubscription.create.mockResolvedValue({
      id: 'sub-1',
      userId,
      vehicleTypeId: pkg.vehicleTypeId,
      fixedSlotId: null,
    });
    prisma.payment.create.mockResolvedValue({ id: 'pay-1', amount: pkg.price });
    wallets.debitInTransaction.mockResolvedValue({
      walletId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
      balanceAfter: new Prisma.Decimal(50000),
    });
    prisma.monthlySubscription.update.mockResolvedValue({});

    const result = await service.register(
      userId,
      { packageId, licensePlate: '59A12345', paymentMethod: 'Wallet' },
      true,
    );

    expect(result.statusCode).toBe(201);
    expect(result.message).toBe('Thanh toán gói bằng ví thành công');
    expect(result.result).toEqual(
      expect.objectContaining({
        paymentMethod: 'Wallet',
        walletBalance: 50000,
        status: 'Active',
      }),
    );
    expect(payos.createPaymentLink).not.toHaveBeenCalled();
  });
});
