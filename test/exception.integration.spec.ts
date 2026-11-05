import { ReservationsService } from '../src/reservations/reservations.service';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import { PayosService } from '../src/integrations/payos-files.service';
import { PlateRecognizerService } from '../src/integrations/plate-recognizer.service';
import { WalletsService } from '../src/wallets/wallets.service';
import { PaymentsService } from '../src/payments/payments.service';
import { ParkingOperationsService } from '../src/parking/parking-operations.service';
import { ParkingSessionsService } from '../src/parking/parking-sessions.service';
import { entryPassPayload } from '../src/common/entry-pass';
import { exitPassExpired, EXIT_GRACE_MS } from '../src/common/exit-pass';
import { MonthlySubscriptionsService } from '../src/subscriptions/monthly-subscriptions.service';
import { ContractsService } from '../src/subscriptions/contracts.service';

const testUrl = process.env.TEST_DATABASE_URL;
const suite = testUrl ? describe : describe.skip;
suite('PostgreSQL exception integrity (isolated database only)', () => {
  let db: PrismaClient;
  let prisma: PrismaService;
  let ops: ParkingOperationsService;
  let payments: PaymentsService;
  let wallets: WalletsService;
  const remote = {
    getPaymentStatus: jest.fn(),
    cancelPaymentLink: jest.fn(),
    createPaymentLink: jest.fn(),
    verifyWebhook: jest.fn(),
  };
  beforeAll(async () => {
    const url = new URL(testUrl!);
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      !url.pathname.endsWith('_test')
    )
      throw new Error(
        'TEST_DATABASE_URL must point to a local *_test database',
      );
    db = new PrismaClient({ datasources: { db: { url: testUrl } } });
    prisma = db as unknown as PrismaService;
    wallets = new WalletsService(prisma, remote as unknown as PayosService);
    payments = new PaymentsService(
      prisma,
      wallets,
      remote as unknown as PayosService,
    );
    ops = new ParkingOperationsService(
      prisma,
      remote as unknown as PayosService,
      {} as PlateRecognizerService,
      new ParkingSessionsService(prisma),
      payments,
      wallets,
    );
    await db.$connect();
  });
  afterAll(async () => {
    await db?.$disconnect();
  });
  async function fixture(balance = 100000) {
    const suffix = randomUUID().slice(0, 8);
    const role = await db.role.upsert({
      where: { roleName: 'customer' },
      create: { roleName: 'customer' },
      update: {},
    });
    const user = await db.user.create({
      data: {
        email: suffix + '@example.test',
        passwordHash: 'test-only',
        roleId: role.id,
      },
    });
    const vt = await db.vehicleType.create({
      data: { typeName: 'Test car ' + suffix },
    });
    const vehicle = await db.vehicle.create({
      data: {
        userId: user.id,
        vehicleTypeId: vt.id,
        licensePlate: 'T' + suffix.toUpperCase(),
      },
    });
    const parking = await db.parking.create({
      data: { name: 'Test ' + suffix, location: 'Test only' },
    });
    const floor = await db.floor.create({
      data: {
        parkingId: parking.id,
        floorName: 'Test ' + suffix,
        totalCapacity: 5,
        dedicatedVehicleTypeId: vt.id,
      },
    });
    const gate = await db.gate.create({
      data: { floorId: floor.id, gateName: 'Entry', gateType: 'Entry' },
    });
    const exit = await db.gate.create({
      data: { floorId: floor.id, gateName: 'Exit', gateType: 'Exit' },
    });
    const slot = await db.parkingSlot.create({
      data: {
        parkingId: parking.id,
        floorId: floor.id,
        vehicleTypeId: vt.id,
        slotCode: 'A1',
      },
    });
    await db.pricingPolicy.create({
      data: {
        vehicleTypeId: vt.id,
        basePrice: 20000,
        baseHours: 1,
        extraHourPrice: 10000,
        nightSurcharge: 0,
        effectiveDate: new Date('2020-01-01'),
      },
    });
    await db.wallet.create({ data: { userId: user.id, balance } });
    return { user, vehicle, vt, parking, floor, gate, exit, slot };
  }
  async function parked(f: Awaited<ReturnType<typeof fixture>>) {
    const session = await db.parkingSession.create({
      data: {
        vehicleId: f.vehicle.id,
        vehicleTypeId: f.vt.id,
        licensePlateIn: f.vehicle.licensePlate,
        entryGateId: f.gate.id,
        entryTime: new Date(Date.now() - 90 * 60000),
        actualSlotId: f.slot.id,
      },
    });
    await db.parkingSlot.update({
      where: { id: f.slot.id },
      data: { status: 'Occupied' },
    });
    return session;
  }
  it('two concurrent wallet prepays debit once and reuse the exit code', async () => {
    const f = await fixture();
    const session = await parked(f);
    const results = await Promise.all([
      ops.prepay(session.id, f.user.id, { paymentMethod: 'Wallet' }),
      ops.prepay(session.id, f.user.id, { paymentMethod: 'Wallet' }),
    ]);
    expect(results.every((x) => x.isSuccess)).toBe(true);
    expect(await db.payment.count({ where: { sessionId: session.id } })).toBe(
      1,
    );
    expect(
      await db.walletTransaction.count({
        where: { wallet: { userId: f.user.id } },
      }),
    ).toBe(1);
    expect(
      Number(
        (await db.wallet.findUniqueOrThrow({ where: { userId: f.user.id } }))
          .balance,
      ),
    ).toBe(70000);
  });
  it('insufficient wallet funds roll back payment, ledger and exit code', async () => {
    const f = await fixture(1);
    const session = await parked(f);
    const result = await ops.prepay(session.id, f.user.id, {
      paymentMethod: 'Wallet',
    });
    expect(result.statusCode).toBe(402);
    expect(await db.payment.count({ where: { sessionId: session.id } })).toBe(
      0,
    );
    expect(
      (await db.parkingSession.findUniqueOrThrow({ where: { id: session.id } }))
        .exitPassCode,
    ).toBeNull();
  });
  it('concurrent entry scans create exactly one session', async () => {
    const f = await fixture();
    const pass = await db.entryPass.create({
      data: {
        userId: f.user.id,
        vehicleId: f.vehicle.id,
        code: 'ABC234',
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    const scan = {
      gateId: f.gate.id,
      qrPayload: entryPassPayload(pass.id, pass.code),
    };
    const results = await Promise.all([ops.checkIn(scan), ops.checkIn(scan)]);
    expect(results.filter((x) => x.statusCode === 201)).toHaveLength(1);
    expect(
      await db.parkingSession.count({ where: { vehicleId: f.vehicle.id } }),
    ).toBe(1);
    expect(
      (await db.entryPass.findUniqueOrThrow({ where: { id: pass.id } })).status,
    ).toBe('Used');
  });
  it('failure after claiming an entry pass restores its usability', async () => {
    const f = await fixture();
    const pass = await db.entryPass.create({
      data: {
        userId: f.user.id,
        vehicleId: f.vehicle.id,
        code: 'ABC234',
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    const fail = jest
      .spyOn(ops as any, 'createActiveSession')
      .mockRejectedValueOnce(new Error('simulated failure'));
    await expect(
      ops.checkIn({
        gateId: f.gate.id,
        qrPayload: entryPassPayload(pass.id, pass.code),
      }),
    ).rejects.toThrow('simulated failure');
    fail.mockRestore();
    expect(
      (await db.entryPass.findUniqueOrThrow({ where: { id: pass.id } })).status,
    ).toBe('Active');
    expect(
      await db.parkingSession.count({ where: { vehicleId: f.vehicle.id } }),
    ).toBe(0);
  });
  it('late deposit is retained for reconciliation without reopening cancellation', async () => {
    const f = await fixture();
    const reservation = await db.reservation.create({
      data: {
        userId: f.user.id,
        vehicleId: f.vehicle.id,
        expectedEntryTime: new Date(Date.now() + 60000),
        status: 'Cancelled',
      },
    });
    const payment = await db.payment.create({
      data: {
        userId: f.user.id,
        reservationId: reservation.id,
        amount: 20000,
        paymentType: 'Deposit',
        paymentStatus: 'Success',
        paymentMethod: 'PayOS',
        paymentTime: new Date(),
      },
    });
    await payments.dispatchPayment(payment.id);
    expect(
      (
        await db.reservation.findUniqueOrThrow({
          where: { id: reservation.id },
        })
      ).status,
    ).toBe('Cancelled');
    expect(
      (await db.payment.findUniqueOrThrow({ where: { id: payment.id } }))
        .reconciliationReason,
    ).toBe('LATE_DEPOSIT');
  });
  it('duplicate dispatch workers credit a received top-up once', async () => {
    const f = await fixture();
    const payment = await db.payment.create({
      data: {
        userId: f.user.id,
        amount: 5000,
        paymentType: 'WalletTopUp',
        paymentStatus: 'Success',
        paymentMethod: 'PayOS',
        paymentTime: new Date(),
      },
    });
    await Promise.all([
      payments.dispatchPayment(payment.id),
      payments.dispatchPayment(payment.id),
    ]);
    expect(
      await db.walletTransaction.count({ where: { paymentId: payment.id } }),
    ).toBe(1);
    expect(
      Number(
        (await db.wallet.findUniqueOrThrow({ where: { userId: f.user.id } }))
          .balance,
      ),
    ).toBe(105000);
  });
  it('expired prepay collects only the difference and issues a new grace window', async () => {
    const f = await fixture();
    const session = await parked(f);
    await ops.prepay(session.id, f.user.id, { paymentMethod: 'Wallet' });
    await db.parkingSession.update({
      where: { id: session.id },
      data: { prepaidAt: new Date(Date.now() - 16 * 60000) },
    });
    await db.pricingPolicy.create({
      data: {
        vehicleTypeId: f.vt.id,
        basePrice: 20000,
        baseHours: 1,
        extraHourPrice: 20000,
        effectiveDate: new Date(),
        status: 'Active',
      },
    });
    const result = await ops.prepay(session.id, f.user.id, {
      paymentMethod: 'Wallet',
    });
    expect(result.isSuccess).toBe(true);
    expect(
      Number(
        (await db.wallet.findUniqueOrThrow({ where: { userId: f.user.id } }))
          .balance,
      ),
    ).toBe(60000);
  });
  it('grace remains valid at exactly 15 minutes and expires after it', () => {
    const prepaidAt = new Date('2026-11-04T00:00:00Z');
    expect(
      exitPassExpired({ prepaidAt }, new Date(+prepaidAt + EXIT_GRACE_MS)),
    ).toBe(false);
    expect(
      exitPassExpired({ prepaidAt }, new Date(+prepaidAt + EXIT_GRACE_MS + 1)),
    ).toBe(true);
  });
  it('database rejects edits to vehicles inside the parking lot', async () => {
    const f = await fixture();
    await parked(f);
    await expect(
      db.vehicle.update({
        where: { id: f.vehicle.id },
        data: { licensePlate: 'NEW' + randomUUID().slice(0, 8) },
      }),
    ).rejects.toThrow();
    expect(
      (await db.vehicle.findUniqueOrThrow({ where: { id: f.vehicle.id } }))
        .licensePlate,
    ).toBe(f.vehicle.licensePlate);
  });
  it('two vehicles racing for one slot cannot both check in', async () => {
    const f = await fixture();
    const other = await db.vehicle.create({
      data: {
        userId: f.user.id,
        vehicleTypeId: f.vt.id,
        licensePlate: 'T' + randomUUID().slice(0, 8).toUpperCase(),
      },
    });
    const scans = [f.vehicle, other].map((v) =>
      ops.checkIn({
        gateId: f.gate.id,
        licensePlate: v.licensePlate,
        vehicleTypeId: v.vehicleTypeId,
        customerType: 'Guest',
      }),
    );
    const results = await Promise.all(scans);
    expect(results.filter((x) => x.isSuccess)).toHaveLength(1);
    expect(
      await db.parkingSession.count({
        where: { actualSlotId: f.slot.id, status: 'Active' },
      }),
    ).toBe(1);
  });
  it('wrong entry gate preserves the unused entry pass', async () => {
    const f = await fixture();
    const other = await fixture();
    const pass = await db.entryPass.create({
      data: {
        userId: f.user.id,
        vehicleId: f.vehicle.id,
        code: 'ABC234',
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    const result = await ops.checkIn({
      gateId: other.gate.id,
      qrPayload: entryPassPayload(pass.id, pass.code),
    });
    expect(result.statusCode).toBe(409);
    expect(
      (await db.entryPass.findUniqueOrThrow({ where: { id: pass.id } })).status,
    ).toBe('Active');
  });
  it('two staff cash confirmations close the session and release its slot once', async () => {
    const f = await fixture();
    const session = await parked(f);
    const checkout = await ops.checkOut({
      sessionId: session.id,
      gateId: f.exit.id,
      paymentMethod: 'Cash',
    });
    expect(checkout.isSuccess).toBe(true);
    const pending = await db.payment.findFirstOrThrow({
      where: { sessionId: session.id, paymentType: 'CheckoutFee' },
    });
    const results = await Promise.all([
      ops.confirmCash(pending.id),
      ops.confirmCash(pending.id),
    ]);
    expect(results.every((r) => r.isSuccess)).toBe(true);
    expect(
      (await db.payment.findUniqueOrThrow({ where: { id: pending.id } }))
        .appliedAt,
    ).toBeInstanceOf(Date);
    expect(
      (await db.parkingSession.findUniqueOrThrow({ where: { id: session.id } }))
        .status,
    ).toBe('Completed');
    expect(
      (await db.parkingSlot.findUniqueOrThrow({ where: { id: f.slot.id } }))
        .status,
    ).toBe('Available');
  });
  it('repeated reservation create reuses one pending deposit', async () => {
    const f = await fixture();
    const car = await db.vehicleType.findUniqueOrThrow({
      where: { typeName: 'Ô tô' },
    });
    await db.vehicle.update({
      where: { id: f.vehicle.id },
      data: { vehicleTypeId: car.id },
    });
    const floor = await db.floor.create({
      data: {
        parkingId: f.parking.id,
        floorName: randomUUID(),
        totalCapacity: 5,
        dedicatedVehicleTypeId: car.id,
      },
    });
    await db.parkingSlot.createMany({
      data: Array.from({ length: 5 }, (_, n) => ({
        parkingId: f.parking.id,
        floorId: floor.id,
        vehicleTypeId: car.id,
        slotCode: 'CAR' + n,
      })),
    });
    remote.createPaymentLink.mockImplementation(async (p: { id: string }) => ({
      orderCode: String(parseInt(p.id.replace(/-/g, '').slice(0, 12), 16)),
      paymentUrl: 'https://example.test',
      paymentLinkId: p.id,
    }));
    const reservations = new ReservationsService(
      prisma,
      remote as unknown as PayosService,
    );
    const body = {
      parkingId: f.parking.id,
      vehicleId: f.vehicle.id,
      expectedEntryTime: new Date(Date.now() + 3600000).toISOString(),
    };
    const results = await Promise.all([
      reservations.create(f.user.id, body),
      reservations.create(f.user.id, body),
    ]);
    expect(results.every((r) => r.isSuccess)).toBe(true);
    expect(
      await db.reservation.count({ where: { vehicleId: f.vehicle.id } }),
    ).toBe(1);
    expect(
      await db.payment.count({
        where: { userId: f.user.id, paymentType: 'Deposit' },
      }),
    ).toBe(1);
  });
  it('simultaneous subscription registration for one vehicle creates one row', async () => {
    const f = await fixture();
    const motorbike = await db.vehicleType.create({
      data: { typeName: 'Xe máy test ' + randomUUID() },
    });
    await db.vehicle.update({
      where: { id: f.vehicle.id },
      data: { vehicleTypeId: motorbike.id },
    });
    const pkg = await db.subscriptionPackage.create({
      data: {
        vehicleTypeId: motorbike.id,
        packageName: 'Test',
        durationMonths: 1,
        durationDays: 30,
        price: 1000,
        allParkings: true,
      },
    });
    remote.createPaymentLink.mockResolvedValue({
      orderCode: String(Date.now()),
      paymentUrl: 'https://example.test',
      paymentLinkId: 'test',
    });
    const service = new MonthlySubscriptionsService(
      prisma,
      remote as unknown as PayosService,
      wallets,
      new ContractsService(prisma),
      { compare: jest.fn().mockResolvedValue(true) } as any,
    );
    const results = await Promise.all([
      service.register(
        f.user.id,
        { packageId: pkg.id, vehicleId: f.vehicle.id },
        true,
      ),
      service.register(
        f.user.id,
        { packageId: pkg.id, vehicleId: f.vehicle.id },
        true,
      ),
    ]);
    expect(results.filter((x) => x.statusCode === 201)).toHaveLength(1);
    expect(
      await db.monthlySubscription.count({
        where: { vehicleId: f.vehicle.id },
      }),
    ).toBe(1);
  });
});
