import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WalletsService } from '../wallets/wallets.service';
import { PayosService } from '../integrations/payos-files.service';
import { PaymentsService } from './payments.service';

describe('PaymentsService webhook', () => {
  it('confirms pending reservation deposit as Success', async () => {
    const payment = {
      id: 'pay-1',
      paymentStatus: 'Pending',
      paymentType: 'Deposit',
      paymentMethod: 'PayOS',
      transactionReference: '123',
      amount: new Prisma.Decimal(50000),
      reservationId: 'res-1',
      sessionId: null,
      subscriptionId: null,
      userId: 'user-1',
    };
    const prisma = {
      payment: {
        findFirst: jest.fn().mockResolvedValue(payment),
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(payment)
          .mockResolvedValue({ ...payment, paymentStatus: 'Success' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      reservation: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'res-1',
          status: 'Pending',
          expectedEntryTime: new Date(Date.now() + 60 * 60e3),
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: WalletsService, useValue: { creditFromPayment: jest.fn() } },
        {
          provide: PayosService,
          useValue: { getPaymentStatus: jest.fn().mockResolvedValue({ status: 'PAID', amountPaid: 50000 }) },
        },
      ],
    }).compile();
    const service = module.get(PaymentsService);

    await service.handleWebhook({
      code: '00',
      data: { orderCode: 123 },
    });

    expect(prisma.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ paymentStatus: 'Success' }),
      }),
    );
    expect(prisma.reservation.updateMany).toHaveBeenCalledWith({
      where: { id: 'res-1', status: 'Pending' },
      data: { status: 'Confirmed' },
    });
  });

  function topUpSetup(remote: { status: string; amountPaid: number }) {
    const payment = {
      id: 'pay-topup',
      paymentStatus: 'Pending',
      paymentType: 'WalletTopUp',
      paymentMethod: 'PayOS',
      transactionReference: '456',
      reservationId: null,
      sessionId: null,
      subscriptionId: null,
      userId: 'user-1',
      amount: new Prisma.Decimal(100000),
    };
    const creditFromPayment = jest.fn();
    const prisma = {
      payment: {
        findFirst: jest.fn().mockResolvedValue(payment),
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(payment)
          .mockResolvedValue({ ...payment, paymentStatus: 'Success' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn(async (fn: (tx: object) => Promise<void>) => fn({})),
    };
    const payos = {
      getPaymentStatus: jest.fn().mockResolvedValue({ amount: 100000, ...remote }),
    };
    const service = new PaymentsService(
      prisma as unknown as PrismaService,
      { creditFromPayment } as unknown as WalletsService,
      payos as unknown as PayosService,
    );
    return { service, prisma, payos, creditFromPayment };
  }

  it('credits the user wallet after PayOS confirms the WalletTopUp is PAID', async () => {
    const { service, payos, creditFromPayment } = topUpSetup({ status: 'PAID', amountPaid: 100000 });

    await service.handleWebhook({ code: '00', data: { orderCode: 456 } });

    expect(payos.getPaymentStatus).toHaveBeenCalledWith('456');
    expect(creditFromPayment).toHaveBeenCalledTimes(1);
  });

  it('ignores a forged success webhook while PayOS still reports PENDING', async () => {
    const { service, prisma, creditFromPayment } = topUpSetup({ status: 'PENDING', amountPaid: 0 });

    await service.handleWebhook({ code: '00', data: { orderCode: 456 } });

    expect(prisma.payment.updateMany).not.toHaveBeenCalled();
    expect(creditFromPayment).not.toHaveBeenCalled();
  });

  it.each(['Deposit', 'SubscriptionFee', 'SubscriptionRenewal', 'CheckoutFee'])(
    'ignores a forged success webhook for %s while PayOS still reports PENDING',
    async (paymentType) => {
      const { service, prisma, payos } = topUpSetup({ status: 'PENDING', amountPaid: 0 });
      prisma.payment.findFirst.mockResolvedValue({ id: 'pay-x', paymentStatus: 'Pending', paymentType });

      await service.handleWebhook({ code: '00', data: { orderCode: 456 } });

      expect(payos.getPaymentStatus).toHaveBeenCalledWith('456');
      expect(prisma.payment.updateMany).not.toHaveBeenCalled();
    },
  );

  it('does not credit an underpaid top-up', async () => {
    const { service, creditFromPayment } = topUpSetup({ status: 'PAID', amountPaid: 50000 });
    expect(await service.syncPayosPayment('pay-topup')).toBe('Pending');
    expect(creditFromPayment).not.toHaveBeenCalled();
  });

  it('webhook and manual check racing: the loser does not credit again', async () => {
    const { service, prisma, creditFromPayment } = topUpSetup({ status: 'PAID', amountPaid: 100000 });
    prisma.payment.updateMany.mockResolvedValue({ count: 0 });
    await service.syncPayosPayment('pay-topup');
    expect(creditFromPayment).not.toHaveBeenCalled();
  });
});

describe('Đối soát PayOS định kỳ', () => {
  function setup(ids: string[]) {
    const prisma = { payment: { findMany: jest.fn().mockResolvedValue(ids.map((id) => ({ id }))) } };
    const service = new PaymentsService(prisma as unknown as PrismaService, {} as WalletsService, {} as PayosService);
    const sync = jest.spyOn(service, 'syncPayosPayment').mockResolvedValue('Success');
    return { service, prisma, sync };
  }

  it('chỉ hỏi thanh toán PayOS đang chờ từ 5 phút đến 3 ngày, mới nhất trước', async () => {
    const { service, prisma } = setup([]);
    await service.reconcilePendingPayos();
    const arg = prisma.payment.findMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({ paymentStatus: 'Pending', paymentMethod: 'PayOS', transactionReference: { not: '' } });
    expect(Date.now() - (arg.where.paymentTime.lt as Date).getTime()).toBeGreaterThanOrEqual(5 * 60e3 - 1000);
    expect(arg.orderBy).toEqual({ paymentTime: 'desc' });
  });

  it('một thanh toán lỗi không chặn các thanh toán sau', async () => {
    const { service, sync } = setup(['p1', 'p2']);
    sync.mockRejectedValueOnce(new Error('PayOS timeout'));
    await service.reconcilePendingPayos();
    expect(sync).toHaveBeenCalledWith('p2');
  });

  it('lượt trước chưa xong thì lượt mới bỏ qua', async () => {
    const { service, prisma, sync } = setup(['p1']);
    let release!: () => void;
    sync.mockImplementationOnce(() => new Promise((r) => (release = () => r('Success'))));
    const first = service.reconcilePendingPayos();
    await new Promise((r) => setImmediate(r));
    await service.reconcilePendingPayos();
    expect(prisma.payment.findMany).toHaveBeenCalledTimes(1);
    release();
    await first;
  });
});
