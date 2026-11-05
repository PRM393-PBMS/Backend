import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { HashingService } from '../auth/services/hashing.service';
import { PayosService } from '../integrations/payos-files.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  InsufficientWalletFundsError,
  WalletsService,
} from '../wallets/wallets.service';
import { SubscriptionRenewalsService } from './subscription-renewals.service';

describe('Gia hạn vé tháng bằng ví', () => {
  const userId = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
  const subId = '3f1d2a9b-7c4e-4f60-8a1b-5e2d9c7b6a33';
  const pkgId = '1b4e28ba-2fa1-11d2-883f-0016d3cca427';
  const oldEnd = new Date(Date.now() + 5 * 864e5);

  let service: SubscriptionRenewalsService;
  let wallets: { debitForUser: jest.Mock; getBalanceForUser: jest.Mock };
  let payos: { createPaymentLink: jest.Mock };
  let tx: any;
  let subscriptionStatus: string;
  let payment: { create: jest.Mock; update: jest.Mock; findFirst: jest.Mock };

  beforeEach(async () => {
    subscriptionStatus = 'Active';
    tx = {
      subscriptionContract: { findUnique: jest.fn().mockResolvedValue(null) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      payment: {
        create: jest.fn().mockResolvedValue({ id: 'pay-1' }),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      monthlySubscription: {
        findUniqueOrThrow: jest.fn(() =>
          Promise.resolve({
            status: subscriptionStatus,
            parkingId: 'p1',
            userId,
            endDate: oldEnd,
          }),
        ),
        findUnique: jest.fn(() =>
          Promise.resolve({
            endDate: oldEnd,
            status: subscriptionStatus,
            fixedSlotId: null,
            package: { allParkings: false, durationDays: 30 },
            vehicle: { vehicleType: { typeName: 'Xe máy' } },
          }),
        ),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      subscriptionRenewal: { create: jest.fn().mockResolvedValue({}) },
    };
    wallets = {
      debitForUser: jest.fn().mockResolvedValue({
        walletId: 'w1',
        balanceAfter: new Prisma.Decimal(100000),
      }),
      getBalanceForUser: jest
        .fn()
        .mockResolvedValue({ walletId: 'w1', walletBalance: 5000 }),
    };
    payos = { createPaymentLink: jest.fn() };
    payment = {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({
        id: 'pay-2',
        amount: new Prisma.Decimal(1500000),
      }),
      update: jest.fn(),
    };
    const prisma = {
      payment,
      user: { findUnique: jest.fn().mockResolvedValue({ passwordHash: 'h' }) },
      monthlySubscription: {
        findUnique: jest.fn(() =>
          Promise.resolve({
            id: subId,
            userId,
            status: subscriptionStatus,
            endDate: oldEnd,
            parkingId: 'p1',
            vehicle: { vehicleTypeId: 'vt' },
          }),
        ),
      },
      subscriptionPackage: {
        findUnique: jest.fn().mockResolvedValue({
          id: pkgId,
          status: 'Active',
          vehicleTypeId: 'vt',
          price: new Prisma.Decimal(1500000),
          durationDays: 30,
          allParkings: false,
          durationMonths: 1,
        }),
      },
      $transaction: jest.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionRenewalsService,
        { provide: PrismaService, useValue: prisma },
        { provide: PayosService, useValue: payos },
        {
          provide: HashingService,
          useValue: {
            compare: jest.fn().mockResolvedValue(true),
            hash: jest.fn(),
          },
        },
        { provide: WalletsService, useValue: wallets },
      ],
    }).compile();
    service = module.get(SubscriptionRenewalsService);
  });

  it('trừ ví, nối thêm 30 ngày từ ngày hết hạn cũ, không tạo link PayOS', async () => {
    const res = await service.renew(subId, userId, {
      packageId: pkgId,
      paymentMethod: 'Wallet',
      password: 'x',
    });
    expect(res.isSuccess).toBe(true);
    expect(wallets.debitForUser).toHaveBeenCalled();
    expect(payos.createPaymentLink).not.toHaveBeenCalled();
    const update = tx.monthlySubscription.updateMany.mock.calls.find(([arg]:any) => arg.data.endDate)[0];
    // Chỉ cập nhật khi ngày hết hạn vẫn là ngày vừa đọc.
    expect(update.where).toMatchObject({ id: subId, endDate: oldEnd });
    const newEnd = update.data.endDate as Date;
    expect(Math.round((newEnd.getTime() - oldEnd.getTime()) / 864e5)).toBe(30);
    expect(tx.payment.create.mock.calls[0][0].data).toMatchObject({
      paymentMethod: 'Wallet',
      paymentStatus: 'Success',
      paymentType: 'SubscriptionRenewal',
      packageId: pkgId,
    });
  });

  it('không trừ ví khi vé đã bị hủy trước lúc lấy khóa', async () => {
    tx.monthlySubscription.findUniqueOrThrow.mockResolvedValue({
      status: 'Cancelled',
      userId,
      parkingId: 'p1',
    });
    const res = await service.renew(subId, userId, {
      packageId: pkgId,
      paymentMethod: 'Wallet',
      password: 'x',
    });
    expect(res.statusCode).toBe(409);
    expect(wallets.debitForUser).not.toHaveBeenCalled();
    expect(tx.payment.create).not.toHaveBeenCalled();
  });

  it('vé chưa thanh toán thì không gia hạn được', async () => {
    subscriptionStatus = 'PendingPayment';
    const res = await service.renew(subId, userId, {
      packageId: pkgId,
      paymentMethod: 'Wallet',
      password: 'x',
    });
    expect(res.statusCode).toBe(409);
    expect(wallets.debitForUser).not.toHaveBeenCalled();
  });

  it('gia hạn PayOS lưu gói khách chọn vào thanh toán', async () => {
    payos.createPaymentLink.mockResolvedValue({
      orderCode: '9',
      paymentUrl: 'u',
      paymentLinkId: 'l',
    });
    await service.renew(subId, userId, { packageId: pkgId, password: 'x' });
    expect(tx.payment.create.mock.calls[0][0].data).toMatchObject({
      packageId: pkgId,
      renewalPackageId: pkgId,
      renewalDurationDays: 30,
      paymentMethod: 'PayOS',
    });
  });

  it('thiếu tiền: 402 kèm số dư, không gia hạn', async () => {
    wallets.debitForUser.mockRejectedValue(new InsufficientWalletFundsError());
    const res = await service.renew(subId, userId, {
      packageId: pkgId,
      paymentMethod: 'Wallet',
      password: 'x',
    });
    expect(res.statusCode).toBe(402);
    expect(res.result).toMatchObject({ walletBalance: 5000, amount: 1500000 });
  });

  it('phương thức lạ thì từ chối', async () => {
    const res = await service.renew(subId, userId, {
      packageId: pkgId,
      paymentMethod: 'Cash',
      password: 'x',
    });
    expect(res.isSuccess).toBe(false);
  });
});
