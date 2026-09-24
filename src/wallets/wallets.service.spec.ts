import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PayosService } from '../integrations/payos-files.service';
import { InsufficientWalletFundsError, WalletsService } from './wallets.service';

describe('WalletsService', () => {
  const userId = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
  const walletId = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
  let service: WalletsService;
  let prisma: {
    user: { findUnique: jest.Mock };
    wallet: { findUnique: jest.Mock; create: jest.Mock; updateMany: jest.Mock };
    walletTransaction: { findMany: jest.Mock; create: jest.Mock };
    payment: { create: jest.Mock; update: jest.Mock };
  };
  let payos: { createPaymentLink: jest.Mock };

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn() },
      wallet: { findUnique: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
      walletTransaction: { findMany: jest.fn(), create: jest.fn() },
      payment: { create: jest.fn(), update: jest.fn() },
    };
    payos = { createPaymentLink: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WalletsService,
        { provide: PrismaService, useValue: prisma },
        { provide: PayosService, useValue: payos },
      ],
    }).compile();
    service = module.get(WalletsService);
  });

  it('returns 401 when listing a wallet without a user', async () => {
    const result = await service.getById('', walletId);
    expect(result.statusCode).toBe(401);
    expect(result.message).toBe('Vui lòng đăng nhập');
  });

  it('forbids reading another user wallet', async () => {
    prisma.wallet.findUnique.mockResolvedValue({
      id: walletId,
      userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      balance: new Prisma.Decimal(1),
    });
    const result = await service.getById(userId, walletId);
    expect(result.statusCode).toBe(403);
    expect(result.message).toBe('Bạn không sở hữu ví này');
  });

  it('maps top-up history as Credit and spend history as Debit with subscription ids', async () => {
    prisma.wallet.findUnique.mockResolvedValue({
      id: walletId,
      userId,
      balance: new Prisma.Decimal(50000),
    });
    prisma.walletTransaction.findMany.mockResolvedValue([
      {
        id: 'tx-credit',
        paymentId: 'pay-top',
        type: 'TopUp',
        amount: new Prisma.Decimal(150000),
        balanceAfter: new Prisma.Decimal(150000),
        createdAt: new Date('2026-09-15T08:30:00.000Z'),
        payment: {
          id: 'pay-top',
          subscriptionId: null,
          paymentMethod: 'PayOS',
          paymentType: 'WalletTopUp',
          transactionReference: '1727',
          subscription: null,
        },
      },
      {
        id: 'tx-debit',
        paymentId: 'pay-sub',
        type: 'SubscriptionFee',
        amount: new Prisma.Decimal(-300000),
        balanceAfter: new Prisma.Decimal(50000),
        createdAt: new Date('2026-09-16T08:30:00.000Z'),
        payment: {
          id: 'pay-sub',
          subscriptionId: 'sub-1',
          paymentMethod: 'Wallet',
          paymentType: 'SubscriptionFee',
          transactionReference: 'WALLET-sub1',
          subscription: {
            id: 'sub-1',
            licensePlate: '59A12345',
            package: { packageName: 'Gói tháng xe máy' },
          },
        },
      },
    ]);

    const all = await service.listTransactions(userId, walletId);
    expect(all.statusCode).toBe(200);
    expect(all.result).toEqual([
      expect.objectContaining({
        direction: 'Credit',
        type: 'TopUp',
        amount: 150000,
        absoluteAmount: 150000,
        paymentId: 'pay-top',
        subscriptionId: null,
        description: 'Nạp ví qua PayOS',
      }),
      expect.objectContaining({
        direction: 'Debit',
        type: 'SubscriptionFee',
        amount: -300000,
        absoluteAmount: 300000,
        paymentId: 'pay-sub',
        subscriptionId: 'sub-1',
        packageName: 'Gói tháng xe máy',
        licensePlate: '59A12345',
        description: 'Mua gói tháng Gói tháng xe máy — 59A12345',
      }),
    ]);

    prisma.walletTransaction.findMany.mockClear();
    await service.listTopUps(userId, walletId);
    expect(prisma.walletTransaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { walletId, type: 'TopUp' } }),
    );

    prisma.walletTransaction.findMany.mockClear();
    await service.listSpends(userId, walletId);
    expect(prisma.walletTransaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { walletId, type: 'SubscriptionFee' } }),
    );
  });

  it('rejects a top-up below the PayOS minimum', async () => {
    prisma.wallet.findUnique.mockResolvedValue({
      id: walletId,
      userId,
      balance: new Prisma.Decimal(0),
    });
    const result = await service.topUp(userId, walletId, { amount: 500 });
    expect(result.isSuccess).toBe(false);
    expect(result.message).toContain('Số tiền nạp phải là số nguyên');
  });

  it('creates a PayOS top-up link without changing the current balance', async () => {
    prisma.wallet.findUnique.mockResolvedValue({
      id: walletId,
      userId,
      balance: new Prisma.Decimal(20000),
    });
    prisma.payment.create.mockResolvedValue({
      id: 'pay-1',
      amount: new Prisma.Decimal(100000),
      paymentType: 'WalletTopUp',
    });
    payos.createPaymentLink.mockResolvedValue({
      paymentUrl: 'https://pay.payos.vn/web/demo',
      paymentLinkId: 'plink_demo',
      qrCode: '',
      orderCode: '1727',
    });

    const result = await service.topUp(userId, walletId, { amount: 100000 });

    expect(result.statusCode).toBe(201);
    expect(result.result).toEqual(
      expect.objectContaining({
        walletId,
        paymentMethod: 'PayOS',
        paymentType: 'WalletTopUp',
        paymentUrl: 'https://pay.payos.vn/web/demo',
        walletBalance: 20000,
      }),
    );
  });

  it('refuses a debit when the stored balance is too low', async () => {
    prisma.wallet.findUnique.mockResolvedValue({
      id: walletId,
      userId,
      balance: new Prisma.Decimal(0),
    });
    prisma.wallet.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.debitInTransaction(prisma as never, userId, new Prisma.Decimal(300000), 'pay-1'),
    ).rejects.toBeInstanceOf(InsufficientWalletFundsError);
  });
});
