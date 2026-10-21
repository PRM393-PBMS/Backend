import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma, WalletBucket } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { PayosService } from '../integrations/payos-files.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PBMS_ROLES_KEY } from '../auth/common/decorators/pbms-roles.decorator';
import { PbmsRolesGuard } from '../auth/common/guards/pbms-roles.guard';
import { CreateWalletAdjustmentDto } from './dto/create-wallet-adjustment.dto';
import { WalletsController } from './wallets.controller';
import { InsufficientWalletFundsError, WalletsService } from './wallets.service';

const D = (value: number) => new Prisma.Decimal(value);

describe('WalletsService', () => {
  const userId = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
  const adminId = '1b4e28ba-2fa1-11d2-883f-0016d3cca427';
  const walletId = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
  let service: WalletsService;
  let prisma: {
    user: { findUnique: jest.Mock };
    wallet: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
    walletTransaction: { findMany: jest.Mock; findFirst: jest.Mock; findUnique: jest.Mock; create: jest.Mock };
    walletAdjustmentLog: { create: jest.Mock };
    payment: { create: jest.Mock; update: jest.Mock };
    $queryRaw: jest.Mock;
    $transaction: jest.Mock;
  };
  let payos: { createPaymentLink: jest.Mock };
  let notifications: { notify: jest.Mock };

  /** Ví giả: cash = ngăn CASH, bonus = ngăn BONUS. */
  const wallet = (cash: number, bonus = 0, bonusExpiresAt: Date | null = null) => ({
    id: walletId,
    userId,
    balance: D(cash),
    bonusBalance: D(bonus),
    bonusExpiresAt,
  });

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn() },
      wallet: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
      walletTransaction: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn().mockResolvedValue({}),
      },
      walletAdjustmentLog: { create: jest.fn() },
      payment: { create: jest.fn(), update: jest.fn() },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => unknown) => fn(prisma));
    payos = { createPaymentLink: jest.fn() };
    notifications = { notify: jest.fn().mockResolvedValue(undefined) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WalletsService,
        { provide: PrismaService, useValue: prisma },
        { provide: PayosService, useValue: payos },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    service = module.get(WalletsService);
  });

  const createdRows = () =>
    prisma.walletTransaction.create.mock.calls.map(([arg]) => arg.data as Record<string, unknown>);

  describe('xem ví', () => {
    it('returns 401 when listing a wallet without a user', async () => {
      const result = await service.getById('', walletId);
      expect(result.statusCode).toBe(401);
      expect(result.message).toBe('Vui lòng đăng nhập');
    });

    it('forbids reading another user wallet', async () => {
      prisma.wallet.findUnique.mockResolvedValue({ ...wallet(1), userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
      const result = await service.getById(userId, walletId);
      expect(result.statusCode).toBe(403);
      expect(result.message).toBe('Bạn không sở hữu ví này');
    });

    it('tách số dư thành tiền nạp và khuyến mãi; khuyến mãi hết hạn không tính vào khả dụng', async () => {
      prisma.walletTransaction.findMany.mockResolvedValue([]);
      prisma.wallet.findUnique.mockResolvedValue(wallet(100000, 30000));
      const fresh = await service.getById(userId, walletId);
      expect(fresh.result).toEqual(
        expect.objectContaining({ walletBalance: 130000, cashBalance: 100000, bonusBalance: 30000 }),
      );

      prisma.wallet.findUnique.mockResolvedValue(wallet(100000, 30000, new Date(Date.now() - 1000)));
      const expired = await service.getById(userId, walletId);
      expect(expired.result).toEqual(
        expect.objectContaining({ walletBalance: 100000, cashBalance: 100000, bonusBalance: 0 }),
      );
    });

    it('maps top-up history as Credit and spend history as Debit with subscription ids', async () => {
      prisma.wallet.findUnique.mockResolvedValue(wallet(50000));
      prisma.walletTransaction.findMany.mockResolvedValue([
        {
          id: 'tx-credit',
          paymentId: 'pay-top',
          type: 'TOP_UP',
          bucket: WalletBucket.CASH,
          amount: D(150000),
          balanceAfter: D(150000),
          referenceType: 'WalletTopUp',
          referenceId: 'pay-top',
          description: null,
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
          type: 'DEBIT',
          bucket: WalletBucket.CASH,
          amount: D(-300000),
          balanceAfter: D(50000),
          referenceType: 'SubscriptionFee',
          referenceId: 'pay-sub',
          description: null,
          createdAt: new Date('2026-09-16T08:30:00.000Z'),
          payment: {
            id: 'pay-sub',
            subscriptionId: 'sub-1',
            paymentMethod: 'Wallet',
            paymentType: 'SubscriptionFee',
            transactionReference: 'WALLET-sub1',
            subscription: {
              id: 'sub-1',
              vehicle: { licensePlate: '59A12345' },
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
          type: 'TOP_UP',
          bucket: 'CASH',
          amount: 150000,
          absoluteAmount: 150000,
          paymentId: 'pay-top',
          subscriptionId: null,
          description: 'Nạp ví qua PayOS',
        }),
        expect.objectContaining({
          direction: 'Debit',
          type: 'DEBIT',
          referenceType: 'SubscriptionFee',
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
        expect.objectContaining({ where: { walletId, type: 'TOP_UP' } }),
      );

      prisma.walletTransaction.findMany.mockClear();
      await service.listSpends(userId, walletId);
      expect(prisma.walletTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { walletId, type: 'DEBIT' } }),
      );
    });
  });

  describe('nạp ví', () => {
    it('rejects a top-up below the PayOS minimum', async () => {
      prisma.wallet.findUnique.mockResolvedValue(wallet(0));
      const result = await service.topUp(userId, walletId, { amount: 500 });
      expect(result.isSuccess).toBe(false);
      expect(result.message).toContain('Số tiền nạp phải là số nguyên');
    });

    it('creates a PayOS top-up link without changing the current balance', async () => {
      prisma.wallet.findUnique.mockResolvedValue(wallet(20000));
      prisma.payment.create.mockResolvedValue({ id: 'pay-1', amount: D(100000), paymentType: 'WalletTopUp' });
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
      expect(prisma.wallet.update).not.toHaveBeenCalled();
    });

    it('webhook nạp ví cộng vào ngăn CASH và không cộng lặp cùng payment', async () => {
      prisma.walletTransaction.findUnique.mockResolvedValue(null);
      prisma.wallet.findUnique.mockResolvedValue(wallet(0));
      prisma.wallet.update.mockResolvedValue({ balance: D(100000) });
      const payment = { id: 'pay-top', userId, amount: D(100000) };

      await service.creditFromPayment(prisma as never, payment);

      expect(prisma.walletTransaction.findUnique).toHaveBeenCalledWith({
        where: { paymentId_bucket: { paymentId: 'pay-top', bucket: WalletBucket.CASH } },
      });
      expect(prisma.wallet.update.mock.calls[0][0].data).toEqual({ balance: { increment: D(100000) } });
      expect(createdRows()[0]).toMatchObject({ type: 'TOP_UP', bucket: 'CASH', referenceId: 'pay-top' });

      prisma.wallet.update.mockClear();
      prisma.walletTransaction.findUnique.mockResolvedValue({ id: 'existing' });
      await service.creditFromPayment(prisma as never, payment);
      expect(prisma.wallet.update).not.toHaveBeenCalled();
    });
  });

  describe('trừ tiền: BONUS trước, CASH sau', () => {
    const debit = (amount: number) =>
      service.debitInTransaction(prisma as never, walletId, D(amount), 'SubscriptionFee', 'pay-1', 'Mua gói tháng');

    beforeEach(() => {
      prisma.wallet.updateMany.mockResolvedValue({ count: 1 });
    });

    it('không có khuyến mãi: trừ toàn bộ ở ngăn CASH, một dòng DEBIT', async () => {
      prisma.wallet.findUnique.mockResolvedValue(wallet(100000));

      const result = await debit(40000);

      expect(prisma.wallet.updateMany.mock.calls[0][0].data).toEqual({
        balance: { decrement: D(40000) },
        bonusBalance: { decrement: D(0) },
      });
      expect(createdRows()).toEqual([
        expect.objectContaining({
          type: 'DEBIT',
          bucket: 'CASH',
          amount: D(-40000),
          balanceAfter: D(60000),
          paymentId: 'pay-1',
          referenceType: 'SubscriptionFee',
          referenceId: 'pay-1',
          description: 'Mua gói tháng',
        }),
      ]);
      expect(result.balanceAfter.toNumber()).toBe(60000);
    });

    it('khuyến mãi đủ: chỉ trừ ngăn BONUS, ngăn CASH giữ nguyên', async () => {
      prisma.wallet.findUnique.mockResolvedValue(wallet(100000, 50000));

      const result = await debit(30000);

      expect(result.bonusDebited.toNumber()).toBe(30000);
      expect(result.cashDebited.toNumber()).toBe(0);
      expect(createdRows()).toEqual([
        expect.objectContaining({ bucket: 'BONUS', amount: D(-30000), balanceAfter: D(20000) }),
      ]);
      expect(result.balanceAfter.toNumber()).toBe(120000);
    });

    it('khuyến mãi thiếu: dùng hết BONUS rồi trừ phần còn lại ở CASH, ghi 2 dòng', async () => {
      prisma.wallet.findUnique.mockResolvedValue(wallet(100000, 30000));

      const result = await debit(50000);

      expect(prisma.wallet.updateMany.mock.calls[0][0]).toEqual({
        where: { id: walletId, balance: D(100000), bonusBalance: D(30000) },
        data: { balance: { decrement: D(20000) }, bonusBalance: { decrement: D(30000) } },
      });
      expect(createdRows()).toEqual([
        expect.objectContaining({ bucket: 'BONUS', amount: D(-30000), balanceAfter: D(0) }),
        expect.objectContaining({ bucket: 'CASH', amount: D(-20000), balanceAfter: D(80000) }),
      ]);
      expect(result.balanceAfter.toNumber()).toBe(80000);
    });

    it('khuyến mãi đã hết hạn thì không được dùng, trừ hẳn vào CASH', async () => {
      prisma.wallet.findUnique.mockResolvedValue(wallet(100000, 50000, new Date(Date.now() - 1000)));

      await debit(30000);

      expect(createdRows()).toEqual([expect.objectContaining({ bucket: 'CASH', amount: D(-30000) })]);
    });

    it('tổng CASH + BONUS không đủ: ném 400 "Số dư khả dụng không đủ", không đụng số dư', async () => {
      prisma.wallet.findUnique.mockResolvedValue(wallet(10000, 5000));

      const error = await debit(20000).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(InsufficientWalletFundsError);
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as Error).message).toBe('Số dư khả dụng không đủ');
      expect(prisma.wallet.updateMany).not.toHaveBeenCalled();
      expect(prisma.walletTransaction.create).not.toHaveBeenCalled();
    });

    it('số dư bị giao dịch khác đổi giữa chừng: đọc lại và tính lại trước khi trừ', async () => {
      prisma.wallet.findUnique
        .mockResolvedValueOnce(wallet(100000, 30000))
        .mockResolvedValueOnce(wallet(100000, 0));
      prisma.wallet.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });

      await debit(50000);

      expect(prisma.wallet.updateMany).toHaveBeenCalledTimes(2);
      expect(createdRows()).toEqual([expect.objectContaining({ bucket: 'CASH', amount: D(-50000) })]);
    });

    it('debitForUser tìm ví theo userId rồi trừ', async () => {
      prisma.wallet.findUnique.mockResolvedValue(wallet(100000));

      await service.debitForUser(prisma as never, userId, D(10000), 'ParkingFee', 'pay-9', 'Phí gửi xe');

      expect(prisma.wallet.findUnique.mock.calls[0][0]).toEqual({ where: { userId } });
      expect(createdRows()[0]).toMatchObject({ referenceType: 'ParkingFee', paymentId: 'pay-9' });
    });
  });

  describe('hoàn tiền về đúng ngăn đã trừ', () => {
    const debitRows = [
      { walletId, type: 'DEBIT', bucket: WalletBucket.BONUS, amount: D(-30000) },
      { walletId, type: 'DEBIT', bucket: WalletBucket.CASH, amount: D(-20000) },
    ];

    it('BONUS về BONUS, CASH về CASH, ghi dòng REFUND cho từng ngăn', async () => {
      prisma.walletTransaction.findMany.mockResolvedValue(debitRows);
      prisma.walletTransaction.findFirst.mockResolvedValue(null);
      prisma.wallet.update
        .mockResolvedValueOnce({ balance: D(80000), bonusBalance: D(30000) })
        .mockResolvedValueOnce({ balance: D(100000), bonusBalance: D(30000) });

      const result = await service.refundTransaction(prisma as never, 'SubscriptionFee', 'pay-1');

      expect(prisma.$queryRaw).toHaveBeenCalled();
      expect(prisma.wallet.update.mock.calls.map(([arg]) => arg.data)).toEqual([
        { bonusBalance: { increment: D(30000) } },
        { balance: { increment: D(20000) } },
      ]);
      expect(createdRows()).toEqual([
        expect.objectContaining({ type: 'REFUND', bucket: 'BONUS', amount: D(30000), balanceAfter: D(30000) }),
        expect.objectContaining({ type: 'REFUND', bucket: 'CASH', amount: D(20000), balanceAfter: D(100000) }),
      ]);
      expect(result?.bonusRefunded.toNumber()).toBe(30000);
      expect(result?.cashRefunded.toNumber()).toBe(20000);
    });

    it('đã hoàn rồi thì gọi lại không cộng thêm', async () => {
      prisma.walletTransaction.findMany.mockResolvedValue(debitRows);
      prisma.walletTransaction.findFirst.mockResolvedValue({ id: 'refund-1' });

      const result = await service.refundTransaction(prisma as never, 'SubscriptionFee', 'pay-1');

      expect(prisma.wallet.update).not.toHaveBeenCalled();
      expect(result?.cashRefunded.toNumber()).toBe(0);
    });

    it('nghiệp vụ không trừ ví: trả null', async () => {
      prisma.walletTransaction.findMany.mockResolvedValue([]);
      expect(await service.refundTransaction(prisma as never, 'SubscriptionFee', 'pay-x')).toBeNull();
    });
  });

  describe('Admin/Manager điều chỉnh ngăn khuyến mãi', () => {
    const dto = (over: Partial<CreateWalletAdjustmentDto> = {}) =>
      Object.assign(new CreateWalletAdjustmentDto(), {
        amount: 50000,
        reasonType: 'COMPENSATION',
        note: 'Bồi thường sự cố barie',
        ...over,
      }) as CreateWalletAdjustmentDto;

    beforeEach(() => {
      prisma.walletAdjustmentLog.create.mockResolvedValue({ id: 'adj-1', reasonType: 'COMPENSATION' });
    });

    it('cộng khuyến mãi: chỉ đổi bonusBalance, đặt hạn dùng, ghi ADJUSTMENT + log + báo khách', async () => {
      prisma.wallet.findUnique.mockResolvedValue(wallet(100000, 10000));
      prisma.wallet.update.mockResolvedValue(wallet(100000, 60000, new Date(Date.now() + 30 * 864e5)));

      const res = await service.adjustBonusBalance(walletId, adminId, dto({ expiryDays: 30 }));

      expect(res.statusCode).toBe(201);
      const update = prisma.wallet.update.mock.calls[0][0].data;
      expect(update.bonusBalance).toEqual({ increment: D(50000) });
      expect(update).not.toHaveProperty('balance');
      expect(update.bonusExpiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 864e5);
      expect(prisma.walletAdjustmentLog.create).toHaveBeenCalledWith({
        data: { walletId, adminId, amount: D(50000), reasonType: 'COMPENSATION', note: 'Bồi thường sự cố barie' },
      });
      expect(createdRows()[0]).toMatchObject({
        type: 'ADJUSTMENT',
        bucket: 'BONUS',
        amount: D(50000),
        balanceAfter: D(60000),
        referenceId: 'adj-1',
      });
      expect(res.result).toEqual(expect.objectContaining({ cashBalance: 100000, bonusBalance: 60000, walletBalance: 160000 }));
      expect(notifications.notify).toHaveBeenCalledWith(userId, expect.objectContaining({ type: 'wallet' }));
    });

    it('thu hồi: không cho ngăn BONUS âm', async () => {
      prisma.wallet.findUnique.mockResolvedValue(wallet(100000, 10000));

      const res = await service.adjustBonusBalance(walletId, adminId, dto({ amount: -20000, reasonType: 'CORRECTION' }));

      expect(res.statusCode).toBe(400);
      expect(res.message).toBe('Số dư khuyến mãi không đủ để thu hồi');
      expect(prisma.wallet.update).not.toHaveBeenCalled();
      expect(prisma.walletAdjustmentLog.create).not.toHaveBeenCalled();
    });

    it('thu hồi trong hạn mức: dòng ADJUSTMENT mang số âm', async () => {
      prisma.wallet.findUnique.mockResolvedValue(wallet(100000, 10000));
      prisma.wallet.update.mockResolvedValue(wallet(100000, 0));

      const res = await service.adjustBonusBalance(walletId, adminId, dto({ amount: -10000, reasonType: 'EXPIRED' }));

      expect(res.statusCode).toBe(201);
      expect(createdRows()[0]).toMatchObject({ bucket: 'BONUS', amount: D(-10000), balanceAfter: D(0) });
    });

    it('ví không tồn tại: 404', async () => {
      prisma.wallet.findUnique.mockResolvedValue(null);
      const res = await service.adjustBonusBalance(walletId, adminId, dto());
      expect(res.statusCode).toBe(404);
    });
  });

  describe('CreateWalletAdjustmentDto', () => {
    const errorsOf = async (body: Record<string, unknown>) =>
      (await validate(plainToInstance(CreateWalletAdjustmentDto, body))).map((e) => e.property);

    it('hợp lệ khi đủ trường', async () => {
      expect(await errorsOf({ amount: -5000, reasonType: 'PROMOTION', note: 'Tặng khách mới', expiryDays: 7 })).toEqual([]);
    });

    it('từ chối amount = 0, reasonType lạ, note < 5 ký tự, expiryDays không dương', async () => {
      expect(await errorsOf({ amount: 0, reasonType: 'GIFT', note: 'abc', expiryDays: 0 })).toEqual(
        expect.arrayContaining(['amount', 'reasonType', 'note', 'expiryDays']),
      );
    });
  });

  it('endpoint điều chỉnh chỉ cho Admin/Manager và gắn guard phân quyền', () => {
    const handler = WalletsController.prototype.adjustBonus;
    expect(Reflect.getMetadata(PBMS_ROLES_KEY, handler)).toEqual(['admin', 'manager']);
    expect(Reflect.getMetadata('__guards__', handler)).toContain(PbmsRolesGuard);
  });
});
