import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WalletsService } from '../wallets/wallets.service';
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

  it('credits the user wallet after a successful WalletTopUp webhook', async () => {
    const payment = {
      id: 'pay-topup',
      paymentStatus: 'Pending',
      paymentType: 'WalletTopUp',
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
        findUnique: jest.fn().mockResolvedValue({ ...payment, paymentStatus: 'Success' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn(async (fn: (tx: object) => Promise<void>) => fn({})),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: WalletsService, useValue: { creditFromPayment } },
      ],
    }).compile();
    const service = module.get(PaymentsService);

    await service.handleWebhook({
      code: '00',
      data: { orderCode: 456 },
    });

    expect(creditFromPayment).toHaveBeenCalled();
  });
});
