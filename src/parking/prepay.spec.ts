import { Prisma } from '@prisma/client';
import { generateExitPassCode, exitPassPayload } from '../common/exit-pass';
import { PayosService } from '../integrations/payos-files.service';
import { PlateRecognizerService } from '../integrations/plate-recognizer.service';
import { PaymentsService } from '../payments/payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { InsufficientWalletFundsError, WalletsService } from '../wallets/wallets.service';
import { ParkingOperationsService } from './parking-operations.service';
import { ParkingSessionsService } from './parking-sessions.service';

const SESSION_ID = '11111111-2222-3333-4444-555555555555';
const USER_ID = '99999999-8888-7777-6666-555555555555';

function setup(opts: { debit: 'ok' | 'insufficient'; ownerId?: string }) {
  const session = {
    id: SESSION_ID,
    status: 'Active',
    licensePlateIn: '51K12345',
    vehicleTypeId: 'vt-car',
    entryTime: new Date(Date.now() - 1.5 * 36e5), // làm tròn lên 2 giờ
    reservationId: null,
    prepaidAt: null as Date | null,
    exitPassCode: null as string | null,
    vehicle: { userId: opts.ownerId ?? USER_ID },
  };
  const tx = {
    payment: {
      create: jest.fn().mockResolvedValue({
        id: 'pay-1',
        sessionId: SESSION_ID,
        reservationId: null,
        amount: new Prisma.Decimal(30000),
        paymentMethod: 'Wallet',
        paymentType: 'PrepaidCheckout',
        paymentTime: new Date(),
        paymentStatus: 'Success',
        transactionReference: '',
      }),
    },
  };
  const prisma = {
    parkingSession: {
      findUnique: jest.fn().mockImplementation(() => Promise.resolve({ ...session })),
      update: jest.fn().mockImplementation(({ data }) => {
        Object.assign(session, data);
        return Promise.resolve(session);
      }),
    },
    payment: { findFirst: jest.fn().mockResolvedValue(null) },
    monthlySubscription: { findFirst: jest.fn().mockResolvedValue(null) },
    pricingPolicy: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'pp',
        basePrice: new Prisma.Decimal(20000),
        baseHours: 1,
        extraHourPrice: new Prisma.Decimal(10000),
        nightSurcharge: new Prisma.Decimal(0),
      }),
    },
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  const wallets = {
    debitInTransaction: jest.fn(() =>
      opts.debit === 'ok'
        ? Promise.resolve({ walletId: 'w1', balanceAfter: new Prisma.Decimal(70000) })
        : Promise.reject(new InsufficientWalletFundsError()),
    ),
    getBalanceForUser: jest.fn().mockResolvedValue({ walletId: 'w1', walletBalance: 5000 }),
  };
  const service = new ParkingOperationsService(
    prisma as unknown as PrismaService,
    {} as PayosService,
    {} as PlateRecognizerService,
    {} as ParkingSessionsService,
    {} as PaymentsService,
    wallets as unknown as WalletsService,
  );
  return { service, session, wallets, tx };
}

describe('Thanh toán trước khi ra bãi', () => {
  it('trả bằng ví: trừ ví loại ParkingFee và cấp mã ra cổng', async () => {
    const { service, session, wallets, tx } = setup({ debit: 'ok' });
    const res = await service.prepay(SESSION_ID, USER_ID, { paymentMethod: 'Wallet' });

    expect(res.isSuccess).toBe(true);
    expect(tx.payment.create.mock.calls[0][0].data).toMatchObject({
      paymentType: 'PrepaidCheckout',
      paymentMethod: 'Wallet',
      userId: USER_ID,
    });
    const debitArgs = wallets.debitInTransaction.mock.calls[0] as unknown[];
    expect(debitArgs[1]).toBe(USER_ID);
    expect((debitArgs[2] as Prisma.Decimal).toNumber()).toBe(30000); // 20k giờ đầu + 10k giờ thứ 2
    expect(debitArgs[4]).toBe('ParkingFee');
    expect(session.exitPassCode).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(session.prepaidAt).toBeInstanceOf(Date);
  });

  it('ví không đủ: trả 402, không cấp mã ra cổng', async () => {
    const { service, session } = setup({ debit: 'insufficient' });
    const res = await service.prepay(SESSION_ID, USER_ID, { paymentMethod: 'Wallet' });

    expect(res.statusCode).toBe(402);
    expect(session.exitPassCode).toBeNull();
  });

  it('người khác không thanh toán hộ được (chủ xe theo vehicle.userId)', async () => {
    const { service, wallets } = setup({ debit: 'ok', ownerId: 'someone-else' });
    const res = await service.prepay(SESSION_ID, USER_ID, { paymentMethod: 'Wallet' });

    expect(res.statusCode).toBe(403);
    expect(wallets.debitInTransaction).not.toHaveBeenCalled();
  });

  it('payload QR mã ra cổng chứa SessionId để đầu đọc cổng nhận diện', () => {
    const code = generateExitPassCode();
    expect(exitPassPayload(SESSION_ID, code)).toBe(`PBMS-EXIT:${SESSION_ID}:${code}`);
  });
});
