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
      reservationId: 'res-1',
      sessionId: null,
      subscriptionId: null,
      userId: 'user-1',
    };
    const prisma = {
      payment: {
        findFirst: jest.fn().mockResolvedValue(payment),
        findUnique: jest.fn().mockResolvedValue({ ...payment, paymentStatus: 'Success' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      reservation: {
        findUnique: jest.fn().mockResolvedValue({ id: 'res-1', status: 'Pending' }),
        update: jest.fn().mockResolvedValue({ id: 'res-1', status: 'Confirmed' }),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: WalletsService, useValue: { creditFromPayment: jest.fn() } },
        { provide: PayosService, useValue: {} },
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
    expect(prisma.reservation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'Confirmed' },
      }),
    );
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
