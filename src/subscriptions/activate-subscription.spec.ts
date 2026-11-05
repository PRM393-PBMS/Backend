import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WalletsService } from '../wallets/wallets.service';
import { PayosService } from '../integrations/payos-files.service';
import { PaymentsService } from '../payments/payments.service';
import {
  SubscriptionActivationError,
  activateSubscriptionInTx,
} from './activate-subscription';

const car = { vehicleTypeId: 'vt-car', vehicleType: { typeName: 'Ô tô' } };

function txWith(subscription: Record<string, unknown>, freeSlots: string[]) {
  const free = new Set(freeSlots);
  return {
    subscriptionContract: { findUnique: jest.fn().mockResolvedValue(null) },
    monthlySubscription: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'sub-1',
        userId: 'user-1',
        status: 'PendingPayment',
        fixedSlotId: null,
        parkingId: 'lot-A',
        package: { durationDays: 30 },
        vehicle: car,
        ...subscription,
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    parkingSlot: {
      findMany: jest.fn().mockResolvedValue(['s1', 's2'].map((id) => ({ id }))),
      // Ô chỉ nhận được khi vẫn trống, giống câu UPDATE ... WHERE status = 'Available'.
      updateMany: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve({ count: free.delete(where.id) ? 1 : 0 }),
      ),
    },
  };
}

describe('Kích hoạt vé tháng', () => {
  it('ô cố định đã có người nhận thì từ chối, không kích hoạt', async () => {
    const tx = txWith({ fixedSlotId: 's1' }, []);
    await expect(
      activateSubscriptionInTx(tx as never, 'sub-1'),
    ).rejects.toThrow(SubscriptionActivationError);
    expect(tx.monthlySubscription.updateMany).not.toHaveBeenCalled();
  });

  it('tự chọn ô: chỉ trong bãi của vé, bỏ ô vừa bị người khác nhận', async () => {
    const tx = txWith({}, ['s2']);
    await activateSubscriptionInTx(tx as never, 'sub-1');
    expect(tx.parkingSlot.findMany.mock.calls[0][0].where).toMatchObject({
      parkingId: 'lot-A',
      status: 'Available',
      vehicleTypeId: 'vt-car',
      floor: { isResident: true },
    });
    expect(tx.parkingSlot.updateMany.mock.calls[0][0].where).toMatchObject({
      id: 's1',
      status: 'Available',
    });
    expect(tx.monthlySubscription.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: 'sub-1', status: 'PendingPayment' },
      data: { status: 'Active', fixedSlotId: 's2' },
    });
    // Kích hoạt không tự bật tự gia hạn: khách tự bật.
    expect(
      tx.monthlySubscription.updateMany.mock.calls[0][0].data,
    ).not.toHaveProperty('autoRenew');
  });

  it('vé đã huỷ thì không kích hoạt', async () => {
    const tx = txWith({ status: 'Cancelled' }, ['s1']);
    await expect(
      activateSubscriptionInTx(tx as never, 'sub-1'),
    ).rejects.toThrow(SubscriptionActivationError);
    expect(tx.parkingSlot.updateMany).not.toHaveBeenCalled();
  });
});

describe('Vé tháng trả qua PayOS và đối soát', () => {
  function setup(paid: Record<string, unknown>, tx: any) {
    const state: any = {
      id: 'pay-1',
      userId: 'user-1',
      subscriptionId: 'sub-1',
      paymentStatus: 'Success',
      amount: new Prisma.Decimal(1500000),
      appliedAt: null,
      reconciliationReason: null,
      ...paid,
    };
    const payment = {
      findUnique: jest.fn(async () => ({ ...state })),
      findUniqueOrThrow: jest.fn(async () => ({ ...state })),
      update: jest.fn(async ({ data }) => Object.assign(state, data)),
      updateMany: jest.fn(async ({ data }) => {
        Object.assign(state, data);
        return { count: 1 };
      }),
    };
    const prisma: any = {
      payment,
      subscriptionPackage: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ id: 'pkg-3m', durationDays: 90 }),
      },
      $transaction: jest.fn(async (fn) =>
        fn({
          ...prisma,
          ...tx,
          payment,
          $queryRaw: jest.fn().mockResolvedValue([]),
        }),
      ),
    };
    const creditRefund = jest.fn();
    const service = new PaymentsService(
      prisma as PrismaService,
      { creditRefund } as unknown as WalletsService,
      {} as PayosService,
    );
    return { service, prisma, state, creditRefund };
  }
  it('ô bị chiếm: giữ chứng từ, chờ đối soát, không tự hủy/hoàn ví', async () => {
    const tx = txWith({ fixedSlotId: 's1' }, []);
    const f = setup({ paymentType: 'SubscriptionFee' }, tx);
    await f.service.dispatchPayment('pay-1');
    expect(f.state.reconciliationReason).toBe('FIXED_SLOT_UNAVAILABLE');
    expect(f.state.appliedAt).toBeNull();
    expect(f.creditRefund).not.toHaveBeenCalled();
    expect(tx.monthlySubscription.updateMany).not.toHaveBeenCalled();
  });
  it('gia hạn cộng đúng snapshot 90 ngày và chỉ áp dụng payment một lần', async () => {
    const oldEnd = new Date(Date.now() + 5 * 864e5);
    const tx: any = {
      subscriptionContract: { findUnique: jest.fn().mockResolvedValue(null) },
      monthlySubscription: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'sub-1',
          userId: 'user-1',
          vehicleId: 'v1',
          packageId: 'pkg-old',
          price: new Prisma.Decimal(500000),
          endDate: oldEnd,
          status: 'Active',
          fixedSlotId: null,
          package: { durationDays: 30 },
          vehicle: {
            vehicleTypeId: 'bike',
            vehicleType: { typeName: 'Xe máy' },
          },
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn(),
      },
      subscriptionRenewal: { create: jest.fn() },
    };
    const f = setup(
      {
        paymentType: 'SubscriptionRenewal',
        renewalPackageId: 'pkg-3m',
        renewalDurationDays: 90,
      },
      tx,
    );
    await f.service.dispatchPayment('pay-1');
    await f.service.dispatchPayment('pay-1');
    const newEnd = tx.monthlySubscription.update.mock.calls[0][0].data
      .endDate as Date;
    expect(Math.round((newEnd.getTime() - oldEnd.getTime()) / 864e5)).toBe(90);
    expect(tx.subscriptionRenewal.create).toHaveBeenCalledTimes(1);
    expect(f.creditRefund).not.toHaveBeenCalled();
  });
});
