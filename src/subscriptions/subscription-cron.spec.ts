import { Prisma } from '@prisma/client';
import { HashingService } from '../auth/services/hashing.service';
import { PayosService } from '../integrations/payos-files.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { InsufficientWalletFundsError, WalletsService } from '../wallets/wallets.service';
import { MonthlySubscriptionsService } from './monthly-subscriptions.service';
import { SubscriptionRenewalsService } from './subscription-renewals.service';
import { ContractsService } from './contracts.service';

const DAY = 864e5;
const pkg = { id: 'pkg-1', status: 'Active', price: new Prisma.Decimal(1500000), durationDays: 30 };

function renewals(subs: object[], balance = 2_000_000) {
  const endDate = new Date(Date.now() + 12 * 3600e3);
  const tx = {
    payment: { create: jest.fn().mockResolvedValue({ id: 'pay-1' }) },
    monthlySubscription: {
      findUnique: jest.fn().mockResolvedValue({ endDate, status: 'Active' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    subscriptionRenewal: { create: jest.fn() },
  };
  const prisma = {
    monthlySubscription: { findMany: jest.fn().mockResolvedValue(subs) },
    $transaction: jest.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  const wallets = {
    debitForUser: jest.fn().mockResolvedValue({ walletId: 'w1', balanceAfter: new Prisma.Decimal(0) }),
    getBalanceForUser: jest.fn().mockResolvedValue({ walletId: 'w1', walletBalance: balance }),
  };
  const notifications = { notify: jest.fn() };
  const service = new SubscriptionRenewalsService(
    prisma as unknown as PrismaService,
    {} as PayosService,
    {} as HashingService,
    wallets as unknown as WalletsService,
    notifications as unknown as NotificationsService,
  );
  return { service, prisma, tx, wallets, notifications, endDate };
}

const sub = (extra: object = {}) => ({
  id: 'sub-1',
  userId: 'user-1',
  status: 'Active',
  autoRenew: true,
  endDate: new Date(Date.now() + 12 * 3600e3),
  package: pkg,
  vehicle: { licensePlate: '51A12345' },
  ...extra,
});

describe('Tự gia hạn bằng ví (00:01)', () => {
  it('chỉ lấy vé đang hiệu lực, đã bật tự gia hạn, còn dưới 1 ngày', async () => {
    const { service, prisma } = renewals([]);
    await service.autoRenewFromWallet();
    const where = prisma.monthlySubscription.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ status: 'Active', autoRenew: true });
    expect((where.endDate.lt as Date).getTime() - Date.now()).toBeGreaterThan(DAY - 5000);
  });

  it('đủ tiền: trừ ví đúng giá gói, cộng 30 ngày, báo khách', async () => {
    const { service, tx, wallets, notifications, endDate } = renewals([sub()]);
    await service.autoRenewFromWallet();
    expect(wallets.debitForUser).toHaveBeenCalledWith(
      tx, 'user-1', pkg.price, 'SubscriptionRenewal', 'pay-1', 'Tự gia hạn vé tháng xe 51A12345',
    );
    const newEnd = tx.monthlySubscription.updateMany.mock.calls[0][0].data.endDate as Date;
    expect(Math.round((newEnd.getTime() - endDate.getTime()) / DAY)).toBe(30);
    expect(notifications.notify).toHaveBeenCalledWith('user-1', expect.objectContaining({ title: 'Đã gia hạn vé tháng' }));
  });

  it('thiếu tiền: không gia hạn, báo nạp ví; vé sau vẫn được xử lý', async () => {
    const { service, wallets, notifications } = renewals([sub(), sub({ id: 'sub-2', userId: 'user-2' })]);
    wallets.debitForUser.mockRejectedValueOnce(new InsufficientWalletFundsError());
    await service.autoRenewFromWallet();
    expect(notifications.notify).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        title: 'Không tự gia hạn được vé tháng',
        type: 'wallet',
        // Giá 1.500.000, ví còn 2.000.000 trong mock: thiếu 0 (vẫn kèm để app mở màn nạp ví).
        metadata: expect.objectContaining({ action: 'topup', amount: 0 }),
      }),
    );
    expect(notifications.notify).toHaveBeenCalledWith('user-2', expect.objectContaining({ title: 'Đã gia hạn vé tháng' }));
  });

  it('gói đã ngừng bán: không trừ ví, báo chọn gói khác', async () => {
    const { service, wallets, notifications } = renewals([sub({ package: { ...pkg, status: 'Inactive' } })]);
    await service.autoRenewFromWallet();
    expect(wallets.debitForUser).not.toHaveBeenCalled();
    expect(notifications.notify.mock.calls[0][1].message).toContain('ngừng bán');
  });
});

describe('Nhắc vé sắp hết hạn (09:00)', () => {
  it('hỏi đúng hai khung: sau 3 ngày và ngày mai', async () => {
    const { service, prisma } = renewals([]);
    await service.remindExpiring();
    const windows = prisma.monthlySubscription.findMany.mock.calls.map(
      ([arg]: [{ where: { endDate: { gte: Date; lt: Date } } }]) =>
        Math.round((arg.where.endDate.gte.getTime() - Date.now()) / DAY),
    );
    expect(windows).toEqual([3, 1]);
  });

  it.each([
    [true, 2_000_000, 'Vé sẽ tự gia hạn, trừ'],
    [true, 100_000, 'vui lòng nạp thêm'],
    [false, 2_000_000, 'Gia hạn để tiếp tục'],
  ])('tự gia hạn=%s, ví %d: nội dung "%s"', async (autoRenew, balance, text) => {
    const { service, prisma, notifications } = renewals([], balance);
    prisma.monthlySubscription.findMany.mockResolvedValueOnce([sub({ autoRenew })]).mockResolvedValueOnce([]);
    await service.remindExpiring();
    expect(notifications.notify).toHaveBeenCalledTimes(1);
    expect(notifications.notify.mock.calls[0][1].message).toContain(text);
  });
});

describe('Bật/tắt tự gia hạn', () => {
  function subscriptions(existing: object | null) {
    const prisma = {
      monthlySubscription: {
        findUnique: jest.fn().mockResolvedValue(existing),
        update: jest.fn(),
      },
    };
    const service = new MonthlySubscriptionsService(
      prisma as unknown as PrismaService,
      {} as PayosService,
      {} as WalletsService,
      {} as ContractsService,
      {} as HashingService,
    );
    return { service, prisma };
  }

  it('chủ vé bật được', async () => {
    const { service, prisma } = subscriptions({ id: 'sub-1', userId: 'user-1', status: 'Active' });
    const res = await service.setAutoRenew('sub-1', 'user-1', { autoRenew: true });
    expect(res.isSuccess).toBe(true);
    expect(prisma.monthlySubscription.update).toHaveBeenCalledWith({ where: { id: 'sub-1' }, data: { autoRenew: true } });
  });

  it('vé người khác thì 404, không đổi', async () => {
    const { service, prisma } = subscriptions({ id: 'sub-1', userId: 'user-2', status: 'Active' });
    const res = await service.setAutoRenew('sub-1', 'user-1', { autoRenew: true });
    expect(res.statusCode).toBe(404);
    expect(prisma.monthlySubscription.update).not.toHaveBeenCalled();
  });

  it('thiếu autoRenew hoặc vé đã huỷ thì từ chối', async () => {
    const { service } = subscriptions({ id: 'sub-1', userId: 'user-1', status: 'Cancelled' });
    expect((await service.setAutoRenew('sub-1', 'user-1', {})).isSuccess).toBe(false);
    expect((await service.setAutoRenew('sub-1', 'user-1', { autoRenew: false })).isSuccess).toBe(false);
  });
});
