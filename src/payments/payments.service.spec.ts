import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
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
    };
    const prisma = {
      payment: {
        findFirst: jest.fn().mockResolvedValue(payment),
        findUnique: jest.fn().mockResolvedValue({ ...payment, paymentStatus: 'Success' }),
        update: jest.fn().mockResolvedValue({ ...payment, paymentStatus: 'Success' }),
      },
      reservation: {
        findUnique: jest.fn().mockResolvedValue({ id: 'res-1', status: 'Pending' }),
        update: jest.fn().mockResolvedValue({ id: 'res-1', status: 'Confirmed' }),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [PaymentsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    const service = module.get(PaymentsService);

    await service.handleWebhook({
      code: '00',
      data: { orderCode: 123 },
    });

    expect(prisma.payment.update).toHaveBeenCalledWith(
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
});
