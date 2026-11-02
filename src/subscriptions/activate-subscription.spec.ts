import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WalletsService } from '../wallets/wallets.service';
import { PayosService } from '../integrations/payos-files.service';
import { PaymentsService } from '../payments/payments.service';
import { SubscriptionActivationError, activateSubscriptionInTx } from './activate-subscription';

const car = { vehicleTypeId: 'vt-car', vehicleType: { typeName: 'Ô tô' } };

function txWith(subscription: Record<string, unknown>, freeSlots: string[]) {
  const free = new Set(freeSlots);
  return {
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
    await expect(activateSubscriptionInTx(tx as never, 'sub-1')).rejects.toThrow(SubscriptionActivationError);
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
    expect(tx.parkingSlot.updateMany.mock.calls[0][0].where).toMatchObject({ id: 's1', status: 'Available' });
    expect(tx.monthlySubscription.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: 'sub-1', status: 'PendingPayment' },
      data: { status: 'Active', fixedSlotId: 's2' },
    });
    // Kích hoạt không tự bật tự gia hạn: khách tự bật.
    expect(tx.monthlySubscription.updateMany.mock.calls[0][0].data).not.toHaveProperty('autoRenew');
  });

  it('vé đã huỷ thì không kích hoạt', async () => {
    const tx = txWith({ status: 'Cancelled' }, ['s1']);
    await expect(activateSubscriptionInTx(tx as never, 'sub-1')).rejects.toThrow(SubscriptionActivationError);
    expect(tx.parkingSlot.updateMany).not.toHaveBeenCalled();
  });
});

describe('Vé tháng trả qua PayOS', () => {
  function setup(paid: Record<string, unknown>, tx: unknown) {
    const creditRefund = jest.fn().mockResolvedValue(true);
    const payment = {
      findUnique: jest.fn().mockResolvedValue({
        id: 'pay-1',
        userId: 'user-1',
        subscriptionId: 'sub-1',
        paymentStatus: 'Success',
        amount: new Prisma.Decimal(1500000),
        ...paid,
      }),
      update: jest.fn(),
    };
    const prisma = {
      payment,
      monthlySubscription: {
        findUnique: jest.fn().mockResolvedValue({ id: 'sub-1', packageId: 'pkg-old' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      subscriptionPackage: {
        findUnique: jest.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve({ durationDays: where.id === 'pkg-3m' ? 90 : 30 }),
        ),
      },
      $transaction: jest.fn((fn: (t: unknown) => Promise<unknown>) => fn({ ...(tx as object), payment })),
    };
    const service = new PaymentsService(
      prisma as unknown as PrismaService,
      { creditRefund } as unknown as WalletsService,
      {} as PayosService,
    );
    return { service, prisma, creditRefund };
  }

  it('không kích hoạt được (ô đã có người nhận): huỷ đơn, hoàn tiền vào ví', async () => {
    const tx = txWith({ fixedSlotId: 's1' }, []);
    const { service, prisma, creditRefund } = setup({ paymentType: 'SubscriptionFee' }, tx);

    await service.dispatchPayment('pay-1');

    expect(prisma.monthlySubscription.updateMany).toHaveBeenCalledWith({
      where: { id: 'sub-1', status: 'PendingPayment' },
      data: { status: 'Cancelled' },
    });
    expect(creditRefund).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'pay-1' }),
      'SubscriptionFee',
      expect.any(String),
    );
    expect(prisma.payment.update).toHaveBeenCalledWith({ where: { id: 'pay-1' }, data: { paymentStatus: 'Refunded' } });
  });

  it('gia hạn cộng thời hạn của gói đã trả, không phải gói cũ của vé', async () => {
    const oldEnd = new Date(Date.now() + 5 * 864e5);
    const tx = {
      monthlySubscription: {
        findUnique: jest.fn().mockResolvedValue({ endDate: oldEnd, status: 'Active' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      subscriptionRenewal: { create: jest.fn() },
    };
    const { service } = setup({ paymentType: 'SubscriptionRenewal', packageId: 'pkg-3m' }, tx);

    await service.dispatchPayment('pay-1');

    const newEnd = tx.monthlySubscription.updateMany.mock.calls[0][0].data.endDate as Date;
    expect(Math.round((newEnd.getTime() - oldEnd.getTime()) / 864e5)).toBe(90);
  });
});
