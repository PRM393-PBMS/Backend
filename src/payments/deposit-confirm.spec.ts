import { Prisma } from '@prisma/client';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { WalletsService } from '../wallets/wallets.service';
import { PayosService } from '../integrations/payos-files.service';
describe('Xác nhận tiền cọc nguyên tử, tiền về trễ cần đối soát', () => {
  function setup(status = 'Pending', late = false) {
    const payment: any = {
      id: 'pay-1',
      userId: 'user-1',
      amount: new Prisma.Decimal(30000),
      paymentStatus: 'Success',
      paymentType: 'Deposit',
      reservationId: 'r1',
      appliedAt: null,
      reconciliationReason: null,
    };
    const reservation = {
      id: 'r1',
      status,
      createdAt: new Date(),
    expectedEntryTime: new Date(Date.now() + (late ? -31 : 60) * 60000),
    };
    const db: any = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      payment: {
        findUnique: jest.fn(async () => ({ ...payment })),
        findUniqueOrThrow: jest.fn(async () => ({ ...payment })),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(async ({ data }) => Object.assign(payment, data)),
        updateMany: jest.fn(async ({ data }) => {
          Object.assign(payment, data);
          return { count: 1 };
        }),
      },
      reservation: {
        findUnique: jest.fn(async () => ({ ...reservation })),
        updateMany: jest.fn(async ({ data }) => {
          Object.assign(reservation, data);
          return { count: 1 };
        }),
      },
    };
    db.$transaction = jest.fn(async (fn) => fn(db));
    const wallets = { creditRefund: jest.fn() };
    const service = new PaymentsService(
      db as PrismaService,
      wallets as unknown as WalletsService,
      {} as PayosService,
    );
    return { service, db, payment, reservation, wallets };
  }
  it('đơn Pending nhận cọc và ghi appliedAt cùng transaction', async () => {
    const f = setup();
    await f.service.dispatchPayment('pay-1');
    expect(f.reservation.status).toBe('Confirmed');
    expect(f.payment.appliedAt).toBeInstanceOf(Date);
    expect(f.wallets.creditRefund).not.toHaveBeenCalled();
  });
  it.each([
    ['Cancelled', false],
    ['NoShow', false],
    ['Completed', false],
    ['Pending', true],
  ])('đơn %s / trễ=%s không phục hồi hoặc tự hoàn ví', async (status, late) => {
    const f = setup(status, late);
    await f.service.dispatchPayment('pay-1');
    expect(f.reservation.status).toBe(status);
    expect(f.payment.appliedAt).toBeNull();
    expect(f.payment.reconciliationReason).toBe('LATE_DEPOSIT');
    expect(f.wallets.creditRefund).not.toHaveBeenCalled();
  });
});
