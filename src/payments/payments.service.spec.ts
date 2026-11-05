import { Prisma } from '@prisma/client';
import { AppError } from '../common/errors';
import { PayosService } from '../integrations/payos-files.service';
import { PrismaService } from '../prisma/prisma.service';
import { WalletsService } from '../wallets/wallets.service';
import { PaymentsService } from './payments.service';

function setup(type = 'WalletTopUp', reservationStatus = 'Pending') {
  const payment = {
    id: 'pay-1',
    userId: 'user-1',
    paymentStatus: 'Pending',
    paymentMethod: 'PayOS',
    paymentType: type,
    amount: new Prisma.Decimal(100000),
    transactionReference: '456',
    sessionId: null,
    subscriptionId: null,
    reservationId: type === 'Deposit' ? 'res-1' : null,
    appliedAt: null as Date | null,
    reconciliationReason: null as string | null,
  };
  const reservation = {
    id: 'res-1',
    status: reservationStatus,
    createdAt: new Date(),
    expectedEntryTime: new Date(Date.now() + 60000),
  };
  const db: any = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    payment: {
      findFirst: jest.fn(({ where }) =>
        Promise.resolve(where.transactionReference ? { ...payment } : null),
      ),
      findUnique: jest.fn(() => Promise.resolve({ ...payment })),
      findUniqueOrThrow: jest.fn(() => Promise.resolve({ ...payment })),
      update: jest.fn(({ data }) => {
        Object.assign(payment, data);
        return Promise.resolve({ ...payment });
      }),
      updateMany: jest.fn(({ data }) => {
        Object.assign(payment, data);
        return Promise.resolve({ count: 1 });
      }),
    },
    reservation: {
      findUnique: jest.fn(() => Promise.resolve({ ...reservation })),
      updateMany: jest.fn(({ data }) => {
        Object.assign(reservation, data);
        return Promise.resolve({ count: 1 });
      }),
      update: jest.fn(({ data }) => {
        Object.assign(reservation, data);
        return Promise.resolve(reservation);
      }),
    },
  };
  db.$transaction = jest.fn(async (fn) => fn(db));
  const payos = {
    verifyWebhook: jest.fn(),
    getPaymentStatus: jest.fn().mockResolvedValue({
      status: 'PAID',
      amount: 100000,
      amountPaid: 100000,
    }),
  };
  const creditFromPayment = jest.fn().mockResolvedValue(undefined);
  const service = new PaymentsService(
    db as PrismaService,
    { creditFromPayment } as unknown as WalletsService,
    payos as unknown as PayosService,
  );
  return { service, db, payment, reservation, payos, creditFromPayment };
}
describe('PaymentsService verified and recoverable settlement', () => {
  it('confirms a pending deposit only after upstream verification', async () => {
    const { service, reservation, payment, payos } = setup('Deposit');
    await service.handleWebhook({
      data: { orderCode: 456 },
      signature: 'verified',
    });
    expect(payos.verifyWebhook).toHaveBeenCalled();
    expect(reservation.status).toBe('Confirmed');
    expect(payment.appliedAt).toBeInstanceOf(Date);
  });
  it('rejects forged signatures before reading or updating payments', async () => {
    const { service, payos, db } = setup();
    payos.verifyWebhook.mockImplementation(() => {
      throw new AppError(400, 'INVALID_WEBHOOK_SIGNATURE', 'Sai chữ ký');
    });
    await expect(
      service.handleWebhook({ data: { orderCode: 456 } }),
    ).rejects.toBeInstanceOf(AppError);
    expect(db.payment.findFirst).not.toHaveBeenCalled();
  });
  it('credits a verified top-up exactly once on replay', async () => {
    const { service, creditFromPayment } = setup();
    await service.syncPayosPayment('pay-1');
    await service.syncPayosPayment('pay-1');
    expect(creditFromPayment).toHaveBeenCalledTimes(1);
  });
  it('does not trust a success body when upstream still reports pending', async () => {
    const { service, payos, creditFromPayment } = setup();
    payos.getPaymentStatus.mockResolvedValue({
      status: 'PENDING',
      amount: 100000,
      amountPaid: 0,
    });
    await service.handleWebhook({ code: '00', data: { orderCode: 456 } });
    expect(creditFromPayment).not.toHaveBeenCalled();
  });
  it('marks underpayment for reconciliation without crediting a wallet', async () => {
    const { service, payos, payment, creditFromPayment } = setup();
    payos.getPaymentStatus.mockResolvedValue({
      status: 'PAID',
      amount: 100000,
      amountPaid: 50000,
    });
    expect(await service.syncPayosPayment('pay-1')).toBe('Pending');
    expect(payment.reconciliationReason).toBe('AMOUNT_MISMATCH');
    expect(creditFromPayment).not.toHaveBeenCalled();
  });
  it('does not reopen cancelled reservations on late deposit', async () => {
    const { service, reservation, payment } = setup('Deposit', 'Cancelled');
    await service.syncPayosPayment('pay-1');
    expect(reservation.status).toBe('Cancelled');
    expect(payment.paymentStatus).toBe('Success');
    expect(payment.reconciliationReason).toBe('LATE_DEPOSIT');
    expect(payment.appliedAt).toBeNull();
  });
  it('recovers a received payment after a transient application failure', async () => {
    const { service, creditFromPayment, payment } = setup();
    creditFromPayment.mockRejectedValueOnce(new Error('transient'));
    await expect(service.syncPayosPayment('pay-1')).rejects.toThrow(
      'transient',
    );
    expect(payment.paymentStatus).toBe('Success');
    expect(payment.appliedAt).toBeNull();
    await service.syncPayosPayment('pay-1');
    expect(payment.appliedAt).toBeInstanceOf(Date);
  });
});
