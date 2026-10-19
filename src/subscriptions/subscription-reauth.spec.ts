import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { HashingService } from '../auth/services/hashing.service';
import { PayosService } from '../integrations/payos-files.service';
import { PrismaService } from '../prisma/prisma.service';
import { WalletsService } from '../wallets/wallets.service';
import { ContractsService } from './contracts.service';
import { MonthlySubscriptionsService } from './monthly-subscriptions.service';
import { SubscriptionRenewalsService } from './subscription-renewals.service';
import { VehicleChangeRequestsService } from './vehicle-change-requests.service';

const userId = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
const subId = '3f1d2a9b-7c4e-4f60-8a1b-5e2d9c7b6a33';

describe('Vé tháng: xác thực lại mật khẩu và đơn chờ thanh toán', () => {
  let subs: MonthlySubscriptionsService;
  let renewals: SubscriptionRenewalsService;
  let changes: VehicleChangeRequestsService;
  let hashing: { compare: jest.Mock; hash: jest.Mock };
  let payos: { getPaymentStatus: jest.Mock; cancelPaymentLink: jest.Mock; createPaymentLink: jest.Mock };
  let prisma: {
    user: { findUnique: jest.Mock };
    monthlySubscription: { findUnique: jest.Mock; findFirst: jest.Mock; update: jest.Mock };
    payment: { findMany: jest.Mock; updateMany: jest.Mock };
    subscriptionContract: { updateMany: jest.Mock; findUnique: jest.Mock };
    subscriptionPackage: { findUnique: jest.Mock };
    vehicle: { findFirst: jest.Mock };
    parkingSlot: { update: jest.Mock };
  };

  beforeEach(async () => {
    hashing = { compare: jest.fn().mockResolvedValue(true), hash: jest.fn() };
    payos = {
      getPaymentStatus: jest.fn().mockResolvedValue({ status: 'PENDING', amount: 0, amountPaid: 0 }),
      cancelPaymentLink: jest.fn().mockResolvedValue(undefined),
      createPaymentLink: jest.fn(),
    };
    prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ passwordHash: 'h' }) },
      monthlySubscription: {
        findUnique: jest.fn().mockResolvedValue({
          id: subId,
          userId,
          status: 'PendingPayment',
          fixedSlotId: null,
          price: new Prisma.Decimal(1500000),
          package: { durationDays: 30 },
          vehicle: { vehicleTypeId: 'vt', vehicleType: { typeName: 'Ô tô' } },
        }),
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      payment: {
        findMany: jest.fn().mockResolvedValue([{ id: 'pay-1', transactionReference: '1729300000000' }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      subscriptionContract: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      subscriptionPackage: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'pkg',
          vehicleTypeId: 'vt',
          status: 'Active',
          allParkings: true,
          requireFixedSlot: false,
          vehicleType: { typeName: 'Ô tô' },
        }),
      },
      vehicle: { findFirst: jest.fn().mockResolvedValue({ id: 'veh', vehicleTypeId: 'vt', vehicleType: { typeName: 'Ô tô' } }) },
      parkingSlot: { update: jest.fn() },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MonthlySubscriptionsService,
        SubscriptionRenewalsService,
        VehicleChangeRequestsService,
        { provide: PrismaService, useValue: prisma },
        { provide: PayosService, useValue: payos },
        { provide: WalletsService, useValue: {} },
        { provide: ContractsService, useValue: {} },
        { provide: HashingService, useValue: hashing },
      ],
    }).compile();
    subs = module.get(MonthlySubscriptionsService);
    renewals = module.get(SubscriptionRenewalsService);
    changes = module.get(VehicleChangeRequestsService);
  });

  it('khách huỷ vé phải nhập mật khẩu', async () => {
    const res = await subs.cancel(subId, userId, 'customer', {});
    expect(res.isSuccess).toBe(false);
    expect(res.message).toContain('mật khẩu');
    expect(prisma.monthlySubscription.update).not.toHaveBeenCalled();
  });

  it('sai mật khẩu thì không huỷ', async () => {
    hashing.compare.mockResolvedValue(false);
    const res = await subs.cancel(subId, userId, 'customer', { password: 'sai' });
    expect(res.message).toBe('Mật khẩu không đúng');
    expect(prisma.monthlySubscription.update).not.toHaveBeenCalled();
  });

  it('huỷ đơn chưa thanh toán: đóng link PayOS, thanh toán treo -> Failed, huỷ hợp đồng chưa ký', async () => {
    const res = await subs.cancel(subId, userId, 'customer', { password: 'dung' });
    expect(res.isSuccess).toBe(true);
    expect(payos.cancelPaymentLink).toHaveBeenCalledWith('1729300000000');
    expect(prisma.payment.updateMany).toHaveBeenCalledWith({
      where: { id: 'pay-1', paymentStatus: 'Pending' },
      data: { paymentStatus: 'Failed' },
    });
    expect(prisma.subscriptionContract.updateMany.mock.calls[0][0].data).toEqual({ status: 'Void' });
  });

  it('quản lý huỷ hộ thì không cần mật khẩu khách', async () => {
    const res = await subs.cancel(subId, 'manager-id', 'manager', {});
    expect(res.isSuccess).toBe(true);
    expect(hashing.compare).not.toHaveBeenCalled();
  });

  it('đổi sang trả bằng ví: link PayOS đã được trả thì không trừ ví', async () => {
    payos.getPaymentStatus.mockResolvedValue({ status: 'PAID', amount: 1500000, amountPaid: 1500000 });
    const res = await subs.createPayment(subId, userId, { paymentMethod: 'Wallet' });
    expect(res.statusCode).toBe(409);
    expect(payos.cancelPaymentLink).not.toHaveBeenCalled();
  });

  it('đăng ký khi xe đang có đơn chờ thanh toán: trả mã đơn cũ để app cho chọn', async () => {
    prisma.monthlySubscription.findFirst.mockResolvedValue({ id: subId, status: 'PendingPayment' });
    const res = await subs.register(userId, { packageId: 'pkg', vehicleId: 'veh' }, true);
    expect(res.statusCode).toBe(409);
    expect(res.result).toEqual({ existingSubscriptionId: subId, status: 'PendingPayment' });
  });

  it('gia hạn và đổi biển số cũng phải nhập mật khẩu', async () => {
    expect((await renewals.renew(subId, userId, { packageId: 'pkg' })).message).toContain('mật khẩu');
    expect((await changes.create(userId, { subscriptionId: subId, newLicensePlate: '51H12345' })).message).toContain(
      'mật khẩu',
    );
  });
});
