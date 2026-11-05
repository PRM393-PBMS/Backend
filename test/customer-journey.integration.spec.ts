import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SchedulerRegistry } from '@nestjs/schedule';
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcrypt';
import { randomUUID, generateKeyPairSync } from 'node:crypto';
import sharp from 'sharp';
import request from 'supertest';
import { SubscriptionRenewalsService } from '../src/subscriptions/subscription-renewals.service';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  FilesService,
  PayosService,
} from '../src/integrations/payos-files.service';
import { PlateRecognizerService } from '../src/integrations/plate-recognizer.service';
import { MailService } from '../src/auth/services/mail.service';
import { OtpStoreService } from '../src/auth/services/otp-store.service';
import { AppError, requestContext } from '../src/common/errors';

const testUrl = process.env.TEST_DATABASE_URL;
const suite = testUrl ? describe : describe.skip;
const PASSWORD = 'Journey_Test_2026!';

/** Full HTTP -> real JWT/guards/interceptors -> real PostgreSQL.
 * External providers are deterministic adapters, never production services. */
suite('Customer navigation journeys (local PostgreSQL)', () => {
  jest.setTimeout(60000);
  let app: INestApplication;
  let db: PrismaClient;
  let passwordHash: string;
  let orderSequence = Date.now();
  let plateSequence = Date.now() % 90000;
  const orders = new Map<string, { amount: number; status: string }>();
  const otpValues = new Map<string, unknown>();
  const plateAdapter = { recognize: jest.fn() };
  const uploadAdapter = {
    saveUpload: jest.fn(async () => ({
      imageUrl: 'https://example.test/test-scan.png',
    })),
  };
  let scanSequence = 0;
  const mail = {
    sendOtp: jest.fn(),
    sendOtpEmail: jest.fn(),
    sendContractSigned: jest.fn(),
  };
  const otp = {
    ready: async () => {},
    throttle: async () => {},
    get: async (key: string) => otpValues.get(key),
    set: async (key: string, value: unknown) => {
      otpValues.set(key, value);
    },
    delete: async (key: string) => {
      otpValues.delete(key);
    },
    consume: async (key: string, value: unknown) => {
      if (JSON.stringify(otpValues.get(key)) !== JSON.stringify(value))
        return false;
      return otpValues.delete(key);
    },
  };
  const payos = {
    createPaymentLink: async (payment: { id: string; amount: unknown }) => {
      const current = await db.payment.findUniqueOrThrow({
        where: { id: payment.id },
      });
      const code = current.transactionReference || String(++orderSequence);
      if (!orders.has(code))
        orders.set(code, { amount: Number(payment.amount), status: 'PENDING' });
      await db.payment.update({
        where: { id: payment.id },
        data: { transactionReference: code },
      });
      return {
        orderCode: code,
        paymentUrl: 'https://example.test/pay/' + code,
        paymentLinkId: code,
        qrCode: 'test-only',
      };
    },
    getPaymentLink: async (code: string) => ({
      orderCode: code,
      paymentUrl: 'https://example.test/pay/' + code,
      paymentLinkId: code,
      qrCode: 'test-only',
    }),
    getPaymentStatus: async (code: string) => {
      const o = orders.get(code);
      if (!o)
        throw new AppError(
          502,
          'TEST_ORDER_MISSING',
          'Không tìm thấy order test',
        );
      return { ...o, amountPaid: o.status === 'PAID' ? o.amount : 0 };
    },
    cancelPaymentLink: async (code: string) => {
      const o = orders.get(code)!;
      if (o.status === 'PAID')
        throw new AppError(409, 'PAYMENT_ALREADY_PAID', 'Đã thanh toán');
      o.status = 'CANCELLED';
    },
    verifyWebhook: (body: any) => {
      if (body.signature !== 'test-signed')
        throw new AppError(400, 'INVALID_WEBHOOK', 'Chữ ký không hợp lệ');
    },
  };

  beforeAll(async () => {
    const url = new URL(testUrl!);
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      !url.pathname.endsWith('_test')
    )
      throw new Error('Local *_test database required');
    db = new PrismaClient({ datasources: { db: { url: testUrl } } });
    await db.$connect();
    passwordHash = await hash(PASSWORD, 4);
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(db)
      .overrideProvider(PayosService)
      .useValue(payos)
      .overrideProvider(PlateRecognizerService)
      .useValue(plateAdapter)
      .overrideProvider(FilesService)
      .useValue(uploadAdapter)
      .overrideProvider(MailService)
      .useValue(mail)
      .overrideProvider(OtpStoreService)
      .useValue(otp)
      .compile();
    app = mod.createNestApplication();
    app.use((req: any, res: any, next: () => void) => {
      const requestId = randomUUID();
      res.setHeader('X-Request-Id', requestId);
      requestContext.run({ requestId }, next);
    });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    for (const job of app.get(SchedulerRegistry).getCronJobs().values())
      job.stop();
  });
  afterEach(() => {
    jest.useRealTimers();
  });
  afterAll(async () => {
    await app?.close();
    await db?.$disconnect();
  });

  async function call(
    method: string,
    path: string,
    token?: string,
    body?: object,
    key?: string,
    status?: number,
  ): Promise<any> {
    let q = (request(app.getHttpServer()) as any)[method](path);
    if (token) q = q.set('Authorization', 'Bearer ' + token);
    if (key) q = q.set('Idempotency-Key', key);
    if (body) q = q.send(body);
    const response = await q;
    if (status) expect(response.status).toBe(status);
    else
      expect({
        status: response.status,
        message: response.body.message,
        errorCode: response.body.errorCode,
      }).toMatchObject({ status: expect.any(Number), errorCode: undefined });
    if (!status || status < 400) {
      expect([200, 201]).toContain(response.status);
      expect(response.body.isSuccess).toBe(true);
    } else expect(response.body.isSuccess).toBe(false);
    return response.body;
  }
  const result = async (...args: Parameters<typeof call>) =>
    (await call(...args)).result;
  const pick = (obj: any, name: string) =>
    obj?.[
      Object.keys(obj).find((k) => k.toLowerCase() === name.toLowerCase())!
    ];
  async function login(email: string) {
    return result('post', '/api/Auth/login', undefined, {
      email,
      password: PASSWORD,
    });
  }
  async function fixture(balance = 200000) {
    const suffix = randomUUID().slice(0, 8);
    const roles = await Promise.all(
      ['customer', 'staff'].map((roleName) =>
        db.role.upsert({
          where: { roleName },
          create: { roleName },
          update: {},
        }),
      ),
    );
    const users = await Promise.all(
      roles.map((r, i) =>
        db.user.create({
          data: {
            email: `journey-${suffix}-${i}@example.test`,
            userName: `j${suffix}${i}`,
            passwordHash,
            roleId: r.id,
          },
        }),
      ),
    );
    const [customer, staff] = await Promise.all(
      users.map((u) => login(u.email)),
    );
    const carType = await db.vehicleType.upsert({
      where: { typeName: 'Ô tô' },
      create: { typeName: 'Ô tô' },
      update: {},
    });
    const parking = await db.parking.create({
      data: { name: 'Journey ' + suffix, location: 'Local test' },
    });
    const floor = await db.floor.create({
      data: {
        parkingId: parking.id,
        floorName: 'Guest ' + suffix,
        dedicatedVehicleTypeId: carType.id,
        totalCapacity: 10,
      },
    });
    const resident = await db.floor.create({
      data: {
        parkingId: parking.id,
        floorName: 'Resident ' + suffix,
        dedicatedVehicleTypeId: carType.id,
        totalCapacity: 5,
        isResident: true,
      },
    });
    await db.parkingSlot.createMany({
      data: Array.from({ length: 10 }, (_, i) => ({
        parkingId: parking.id,
        floorId: floor.id,
        vehicleTypeId: carType.id,
        slotCode: 'G' + i,
      })),
    });
    const slot = await db.parkingSlot.create({
      data: {
        parkingId: parking.id,
        floorId: resident.id,
        vehicleTypeId: carType.id,
        slotCode: 'R1',
      },
    });
    const entry = await db.gate.create({
      data: { floorId: floor.id, gateName: 'Entry', gateType: 'Entry' },
    });
    const exit = await db.gate.create({
      data: { floorId: floor.id, gateName: 'Exit', gateType: 'Exit' },
    });
    // Pricing is global by vehicle type in the current application.
    await db.pricingPolicy.upsert({
      where: { id: '11111111-1111-4111-8111-111111111101' },
      create: {
        id: '11111111-1111-4111-8111-111111111101',
        vehicleTypeId: carType.id,
        basePrice: 20000,
        baseHours: 1,
        extraHourPrice: 10000,
        nightSurcharge: 0,
        effectiveDate: new Date('2020-01-01T00:00:00Z'),
      },
      update: {},
    });
    const vehicle = await result(
      'post',
      '/api/vehicles',
      customer.accessToken,
      {
        vehicleTypeId: carType.id,
        licensePlate: '51H' + String(++plateSequence).padStart(5, '0'),
      },
    );
    const wallet = await result('post', '/api/wallet', customer.accessToken);
    await db.wallet.update({
      where: { id: wallet.walletId },
      data: { balance },
    });
    const pkg = await db.subscriptionPackage.create({
      data: {
        packageName: 'Journey ' + suffix,
        vehicleTypeId: carType.id,
        price: 50000,
        durationDays: 30,
        durationMonths: 1,
        requireFixedSlot: true,
      },
    });
    return {
      customer,
      staff,
      user: users[0],
      staffUser: users[1],
      carType,
      vehicle,
      parking,
      floor,
      resident,
      slot,
      entry,
      exit,
      wallet,
      pkg,
    };
  }
  async function enter(f: Awaited<ReturnType<typeof fixture>>) {
    const pass = await result(
      'post',
      '/api/entry-passes',
      f.customer.accessToken,
      { vehicleId: f.vehicle.vehicleId, parkingId: f.parking.id },
    );
    const entered = await result(
      'post',
      '/api/ParkingOperation/check-in',
      f.staff.accessToken,
      { gateId: f.entry.id, qrPayload: pass.qrPayload },
    );
    const sessionId = pick(entered, 'Session')?.sessionId ?? entered.sessionId;
    expect(sessionId).toBeTruthy();
    return { sessionId, pass };
  }
  async function scanPlate(
    f: Awaited<ReturnType<typeof fixture>>,
    gateId: string,
    expected: string,
  ) {
    await result('put', '/api/GateScan/my-gate', f.staff.accessToken, {
      gateId,
    });
    const current = await result(
      'get',
      '/api/GateScan/my-gate',
      f.staff.accessToken,
    );
    expect(current.gateId).toBe(gateId);
    plateAdapter.recognize.mockResolvedValue({
      licensePlate: f.vehicle.licensePlate,
      confidence: 0.99,
    });
    const image = await sharp({
      create: { width: 8, height: 8, channels: 3, background: 'white' },
    })
      .png()
      .toBuffer();
    const response = await request(app.getHttpServer())
      .post('/api/GateScan')
      .set('Authorization', 'Bearer ' + f.staff.accessToken)
      .field('gateId', gateId)
      .field('capturedAt', new Date(Date.now() + ++scanSequence).toISOString())
      .attach('file', image, {
        filename: 'test-plate.png',
        contentType: 'image/png',
      });
    expect(response.status).toBe(201);
    expect(response.body.isSuccess).toBe(true);
    expect(response.body.result).toMatchObject({
      suggestedType: expected,
      licensePlate: f.vehicle.licensePlate,
      gateId,
    });
    const recent = await result(
      'get',
      '/api/GateScan/recent?mine=true&gateId=' + gateId,
      f.staff.accessToken,
    );
    expect(
      recent.some((r: any) => r.scanId === response.body.result.scanId),
    ).toBe(true);
    return response.body.result;
  }
  async function pay(paymentId: string) {
    const p = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
    orders.get(p.transactionReference!)!.status = 'PAID';
  }

  it('J01 login -> profile -> refresh -> logout; old token cannot cross account/role boundaries', async () => {
    const f = await fixture();
    const profile = await result('get', '/api/profile', f.customer.accessToken);
    expect(profile.userId).toBe(f.user.id);
    const refreshed = await result(
      'post',
      '/api/Auth/refresh-token',
      undefined,
      { refreshTokenKey: f.customer.refreshToken },
    );
    expect(refreshed.accessToken).toBeTruthy();
    await call(
      'post',
      '/api/ParkingOperation/check-in',
      f.customer.accessToken,
      {},
      undefined,
      403,
    );
    await call('post', '/api/Auth/logout', f.customer.accessToken, {
      refreshTokenKey: f.customer.refreshToken,
    });
    await call(
      'post',
      '/api/Auth/refresh-token',
      undefined,
      { refreshTokenKey: f.customer.refreshToken },
      undefined,
      401,
    );
  });
  it('J02 catalog -> add vehicle -> own list; duplicate and foreign ownership fail safely', async () => {
    const f = await fixture();
    const vehicles = await result(
      'get',
      '/api/vehicles/my',
      f.customer.accessToken,
    );
    expect(vehicles.some((v: any) => v.vehicleId === f.vehicle.vehicleId)).toBe(
      true,
    );
    await call('get', '/api/VehicleType', f.customer.accessToken);
    await call('get', '/api/PricingPolicy', f.customer.accessToken);
    await call(
      'post',
      '/api/vehicles',
      f.customer.accessToken,
      { vehicleTypeId: f.carType.id, licensePlate: f.vehicle.licensePlate },
      undefined,
      409,
    );
    await call(
      'get',
      '/api/vehicles/' + f.vehicle.vehicleId,
      f.staff.accessToken,
      undefined,
      undefined,
      404,
    );
  });
  it('J03 EntryPass -> check-in -> fee -> wallet -> exit -> history; repeated prepay has one debit', async () => {
    const f = await fixture();
    const unused = await result(
      'post',
      '/api/entry-passes',
      f.customer.accessToken,
      { vehicleId: f.vehicle.vehicleId, parkingId: f.parking.id },
    );
    expect(unused.qrPayload).toBeTruthy();
    const pendingScan = await scanPlate(f, f.entry.id, 'EntryPass');
    expect(pendingScan.match.entryPass.entryPassId).toBe(unused.entryPassId);
    const pass = unused;
    const entered = await result(
      'post',
      '/api/ParkingOperation/check-in',
      f.staff.accessToken,
      { gateId: f.entry.id, qrPayload: pass.qrPayload },
    );
    const sessionId = pick(entered, 'Session')?.sessionId ?? entered.sessionId;
    expect(sessionId).toBeTruthy();
    await result(
      'patch',
      '/api/GateScan/' + pendingScan.scanId + '/status',
      f.staff.accessToken,
      { status: 'Handled' },
    );
    const inside = await scanPlate(f, f.entry.id, 'Inside');
    expect(inside.match.activeSession.sessionId).toBe(sessionId);
    const staffView = await result(
      'get',
      '/api/ParkingSession/' + sessionId,
      f.staff.accessToken,
    );
    expect(staffView).toMatchObject({
      status: 'Active',
      licensePlateIn: f.vehicle.licensePlate,
      vehicleId: f.vehicle.vehicleId,
    });
    const qr = await result(
      'post',
      '/api/ParkingOperation/resolve-qr-payload',
      f.staff.accessToken,
      { qrPayload: pass.qrPayload },
    );
    expect(qr.sessionId).toBe(sessionId);
    const mine = await result(
      'get',
      '/api/ParkingSession/my',
      f.customer.accessToken,
    );
    expect(mine).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sessionId, status: 'Active' }),
      ]),
    );
    await call(
      'post',
      '/api/ParkingOperation/check-in',
      f.staff.accessToken,
      { gateId: f.entry.id, qrPayload: pass.qrPayload },
      undefined,
      409,
    );
    const path = `/api/ParkingSession/my/${sessionId}`;
    await call('get', path + '/fee-preview', f.customer.accessToken);
    const key = randomUUID();
    const paid = await result(
      'post',
      path + '/prepay',
      f.customer.accessToken,
      { paymentMethod: 'Wallet' },
      key,
    );
    const repeat = await result(
      'post',
      path + '/prepay',
      f.customer.accessToken,
      { paymentMethod: 'Wallet' },
      key,
    );
    expect(pick(paid, 'ExitPass').code).toBe(pick(repeat, 'ExitPass').code);
    expect(
      await db.payment.count({
        where: { sessionId, paymentStatus: 'Success' },
      }),
    ).toBe(1);
    await call('get', path + '/exit-pass', f.customer.accessToken);
    const exitScan = await scanPlate(f, f.exit.id, 'Checkout');
    expect(exitScan.match.activeSession.sessionId).toBe(sessionId);
    await call('post', '/api/ParkingOperation/check-out', f.staff.accessToken, {
      gateId: f.exit.id,
      sessionId,
      licensePlateOut: f.vehicle.licensePlate,
    });
    expect(
      (await db.parkingSession.findUniqueOrThrow({ where: { id: sessionId } }))
        .status,
    ).toBe('Completed');
    const history = await result(
      'get',
      '/api/payments/my?page=1&pageSize=1',
      f.customer.accessToken,
    );
    expect(history.items).toHaveLength(1);
    expect(history.items[0].isApplied).toBe(true);
  });
  it('J04 PayOS -> sync -> expired permit -> settle difference; received but unapplied is not success', async () => {
    const f = await fixture();
    const { sessionId } = await enter(f);
    const path = `/api/ParkingSession/my/${sessionId}`;
    const draft = await result(
      'post',
      path + '/prepay',
      f.customer.accessToken,
      { paymentMethod: 'PayOS' },
    );
    const paymentId = pick(draft, 'Payment').paymentId;
    await pay(paymentId);
    const synced = await result(
      'get',
      `/api/payments/${paymentId}/sync`,
      f.customer.accessToken,
    );
    expect(synced.isApplied).toBe(true);
    jest.useFakeTimers({
      now: Date.now() + 121 * 60000,
      doNotFake: [
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'setImmediate',
        'clearImmediate',
        'nextTick',
        'queueMicrotask',
        'hrtime',
        'performance',
      ],
    });
    f.customer.accessToken = (await login(f.user.email)).accessToken;
    f.staff.accessToken = (await login(f.staffUser.email)).accessToken;
    const expired = await result(
      'get',
      path + '/exit-pass',
      f.customer.accessToken,
    );
    expect(pick(expired, 'ExitPass')?.isExpired ?? expired.isExpired).toBe(
      true,
    );
    const fee = await result(
      'get',
      path + '/fee-preview',
      f.customer.accessToken,
    );
    expect(fee.remainingAmount).toBeGreaterThanOrEqual(0);
    await call('post', path + '/prepay', f.customer.accessToken, {
      paymentMethod: 'Wallet',
    });
    expect(
      (
        await db.payment.aggregate({
          where: { sessionId, paymentStatus: 'Success' },
          _sum: { amount: true },
        })
      )._sum.amount!.toNumber(),
    ).toBe(fee.grossAmount);
    await result(
      'post',
      '/api/ParkingOperation/check-out',
      f.staff.accessToken,
      { gateId: f.exit.id, sessionId, licensePlateOut: f.vehicle.licensePlate },
    );
    expect(
      (await db.parkingSession.findUniqueOrThrow({ where: { id: sessionId } }))
        .status,
    ).toBe('Completed');
  });
  it('J05 reservation -> duplicate reuse -> cancel -> late deposit is reconciliation, never confirmed', async () => {
    const f = await fixture();
    const body = {
      vehicleId: f.vehicle.vehicleId,
      parkingId: f.parking.id,
      expectedEntryTime: new Date(Date.now() + 3600000).toISOString(),
    };
    await call(
      'get',
      `/api/reservations/availability?parkingId=${f.parking.id}&time=${encodeURIComponent(body.expectedEntryTime)}`,
      f.customer.accessToken,
    );
    const r = await result(
      'post',
      '/api/reservations',
      f.customer.accessToken,
      body,
    );
    const same = await result(
      'post',
      '/api/reservations',
      f.customer.accessToken,
      body,
    );
    expect(same.reservationId).toBe(r.reservationId);
    await call(
      'put',
      `/api/reservations/${r.reservationId}/cancel`,
      f.customer.accessToken,
      {},
    );
    await pay(r.paymentId);
    const late = await result(
      'get',
      `/api/payments/${r.paymentId}/sync`,
      f.customer.accessToken,
    );
    expect(late.applicationStatus).toBe('ReconciliationRequired');
    expect(
      (
        await db.reservation.findUniqueOrThrow({
          where: { id: r.reservationId },
        })
      ).status,
    ).toBe('Cancelled');
  });
  it('J06 subscribe with wallet -> fixed slot -> renew -> cancel; scope and autoRenew remain explicit', async () => {
    const f = await fixture();
    const sub = await result(
      'post',
      '/api/MonthlySubscription/register',
      f.customer.accessToken,
      {
        packageId: f.pkg.id,
        vehicleId: f.vehicle.vehicleId,
        parkingId: f.parking.id,
        fixedSlotId: f.slot.id,
        paymentMethod: 'Wallet',
      },
    );
    let saved = await db.monthlySubscription.findUniqueOrThrow({
      where: { id: sub.subscriptionId },
    });
    expect(saved.status).toBe('Active');
    expect(saved.autoRenew).toBe(false);
    const oldEnd = saved.endDate.getTime();
    await call(
      'post',
      `/api/SubscriptionRenewal/${saved.id}/renew`,
      f.customer.accessToken,
      { packageId: f.pkg.id, paymentMethod: 'Wallet', password: PASSWORD },
      randomUUID(),
    );
    saved = await db.monthlySubscription.findUniqueOrThrow({
      where: { id: sub.subscriptionId },
    });
    expect(saved.endDate.getTime() - oldEnd).toBe(30 * 86400000);
    await call(
      'put',
      `/api/MonthlySubscription/${saved.id}/cancel`,
      f.customer.accessToken,
      { password: PASSWORD },
    );
    await call(
      'post',
      `/api/SubscriptionRenewal/${saved.id}/renew`,
      f.customer.accessToken,
      { packageId: f.pkg.id, paymentMethod: 'Wallet', password: PASSWORD },
      undefined,
      400,
    );
  });
  it('J07 wallet -> top-up -> repeated sync -> paginated history; a different key payload conflicts', async () => {
    const f = await fixture();
    const path = `/api/wallet/${f.wallet.walletId}/top-up`;
    const key = randomUUID();
    const topup = await result(
      'post',
      path,
      f.customer.accessToken,
      { amount: 100000 },
      key,
    );
    await call(
      'post',
      path,
      f.customer.accessToken,
      { amount: 200000 },
      key,
      409,
    );
    await pay(topup.paymentId);
    await call(
      'get',
      `/api/payments/${topup.paymentId}/sync`,
      f.customer.accessToken,
    );
    await call(
      'get',
      `/api/payments/${topup.paymentId}/sync`,
      f.customer.accessToken,
    );
    expect(
      (
        await db.wallet.findUniqueOrThrow({ where: { id: f.wallet.walletId } })
      ).balance.toNumber(),
    ).toBe(300000);
    expect(
      await db.walletTransaction.count({
        where: { paymentId: topup.paymentId },
      }),
    ).toBe(1);
    const first = await result(
      'get',
      '/api/payments/my?page=1&pageSize=1',
      f.customer.accessToken,
    );
    const last = await result(
      'get',
      '/api/payments/my?page=2&pageSize=1',
      f.customer.accessToken,
    );
    expect(first.items).toHaveLength(1);
    expect(last.items).toHaveLength(0);
    expect(last.hasMore).toBe(false);
  });
  it('J08 cash checkout -> customer polling -> staff confirmation -> applied receipt remains visible', async () => {
    const f = await fixture();
    const { sessionId } = await enter(f);
    const checkout = await result(
      'post',
      '/api/ParkingOperation/check-out',
      f.staff.accessToken,
      {
        gateId: f.exit.id,
        sessionId,
        licensePlateOut: f.vehicle.licensePlate,
        paymentMethod: 'Cash',
      },
    );
    const paymentId = pick(checkout, 'Payment').paymentId;
    const path = `/api/ParkingSession/my/${sessionId}/checkout-payment`;
    const waiting = await result('get', path, f.customer.accessToken);
    expect(pick(waiting, 'Payment').paymentStatus).toBe('Pending');
    await call(
      'post',
      `/api/ParkingOperation/check-out/payment/${paymentId}/confirm-cash`,
      f.staff.accessToken,
      {},
    );
    const confirmed = await result('get', path, f.customer.accessToken);
    expect(pick(confirmed, 'Payment')).toMatchObject({
      paymentStatus: 'Success',
      isApplied: true,
    });
  });
  it('J05b expired reservation hold cannot receive a late deposit before cron runs', async () => {
    const f = await fixture();
    const r = await result(
      'post',
      '/api/reservations',
      f.customer.accessToken,
      {
        vehicleId: f.vehicle.vehicleId,
        parkingId: f.parking.id,
        expectedEntryTime: new Date(Date.now() + 3600000).toISOString(),
      },
    );
    await db.reservation.update({
      where: { id: r.reservationId },
      data: { createdAt: new Date(Date.now() - 16 * 60000) },
    });
    await pay(r.paymentId);
    const late = await result(
      'get',
      '/api/payments/' + r.paymentId + '/sync',
      f.customer.accessToken,
    );
    expect(late.applicationStatus).toBe('ReconciliationRequired');
    expect(
      (
        await db.reservation.findUniqueOrThrow({
          where: { id: r.reservationId },
        })
      ).status,
    ).not.toBe('Confirmed');
  });
  it('J06b wallet renewal cannot change a single-parking subscription into an all-parking package', async () => {
    const f = await fixture();
    const sub = await result(
      'post',
      '/api/MonthlySubscription/register',
      f.customer.accessToken,
      {
        packageId: f.pkg.id,
        vehicleId: f.vehicle.vehicleId,
        parkingId: f.parking.id,
        fixedSlotId: f.slot.id,
        paymentMethod: 'Wallet',
      },
    );
    const broader = await db.subscriptionPackage.create({
      data: {
        packageName: 'All ' + randomUUID(),
        vehicleTypeId: f.carType.id,
        price: 50000,
        durationDays: 30,
        durationMonths: 1,
        allParkings: true,
      },
    });
    const before = (
      await db.wallet.findUniqueOrThrow({ where: { id: f.wallet.walletId } })
    ).balance.toString();
    await call(
      'post',
      '/api/SubscriptionRenewal/' + sub.subscriptionId + '/renew',
      f.customer.accessToken,
      { packageId: broader.id, paymentMethod: 'Wallet', password: PASSWORD },
      undefined,
      409,
    );
    expect(
      (
        await db.wallet.findUniqueOrThrow({ where: { id: f.wallet.walletId } })
      ).balance.toString(),
    ).toBe(before);
  });
  it('J03b insufficient balance rolls back; top-up then retrying same intent can succeed', async () => {
    const f = await fixture(0);
    const { sessionId } = await enter(f);
    const path = '/api/ParkingSession/my/' + sessionId + '/prepay';
    const key = randomUUID();
    await call(
      'post',
      path,
      f.customer.accessToken,
      { paymentMethod: 'Wallet' },
      key,
      402,
    );
    const top = await result(
      'post',
      '/api/wallet/' + f.wallet.walletId + '/top-up',
      f.customer.accessToken,
      { amount: 100000 },
    );
    await pay(top.paymentId);
    await call(
      'get',
      '/api/payments/' + top.paymentId + '/sync',
      f.customer.accessToken,
    );
    // A confirmed failure is a new explicit retry, not an uncertain duplicate.
    await call(
      'post',
      path,
      f.customer.accessToken,
      { paymentMethod: 'Wallet' },
      randomUUID(),
    );
    expect(
      await db.payment.count({
        where: { sessionId, paymentStatus: 'Success' },
      }),
    ).toBe(1);
  });
  it('J06c two auto-renew workers read the same due ticket; only one period is charged', async () => {
    const f = await fixture();
    const sub = await result(
      'post',
      '/api/MonthlySubscription/register',
      f.customer.accessToken,
      {
        packageId: f.pkg.id,
        vehicleId: f.vehicle.vehicleId,
        parkingId: f.parking.id,
        fixedSlotId: f.slot.id,
        paymentMethod: 'Wallet',
      },
    );
    const endDate = new Date(Date.now() + 10 * 3600000);
    await db.monthlySubscription.update({
      where: { id: sub.subscriptionId },
      data: { autoRenew: true, endDate },
    });
    const before = (
      await db.wallet.findUniqueOrThrow({ where: { id: f.wallet.walletId } })
    ).balance.toNumber();
    const svc = app.get(SubscriptionRenewalsService);
    await Promise.all([svc.autoRenewFromWallet(), svc.autoRenewFromWallet()]);
    const after = await db.monthlySubscription.findUniqueOrThrow({
      where: { id: sub.subscriptionId },
    });
    expect(after.endDate.getTime() - endDate.getTime()).toBe(30 * 86400000);
    expect(
      (
        await db.wallet.findUniqueOrThrow({ where: { id: f.wallet.walletId } })
      ).balance.toNumber(),
    ).toBe(before - 50000);
    expect(
      await db.payment.count({
        where: {
          subscriptionId: sub.subscriptionId,
          paymentType: 'SubscriptionRenewal',
        },
      }),
    ).toBe(1);
  });
  it('J01b register -> resend after wait -> verify -> login -> reset -> revoked refresh', async () => {
    const suffix = randomUUID().replace(/-/g, '').slice(0, 8);
    const email = 'otp-' + suffix + '@example.test';
    const body = {
      userName: 'otp' + suffix,
      fullName: 'Khách kiểm thử',
      email,
      phoneNumber: '09' + String(Date.now() % 100000000).padStart(8, '0'),
      password: PASSWORD,
      confirmPassword: PASSWORD,
    };
    await call('post', '/api/Auth/send-register-otp', undefined, body);
    await call(
      'post',
      '/api/Auth/resend-register-otp',
      undefined,
      { email },
      undefined,
      429,
    );
    const cached = otpValues.get('Register_' + email) as any;
    cached.sentAt = Date.now() - 61000;
    await call('post', '/api/Auth/resend-register-otp', undefined, { email });
    const code = mail.sendOtpEmail.mock.calls
      .filter(([to]) => to === email)
      .at(-1)![1];
    await call(
      'post',
      '/api/Auth/verify-register-otp',
      undefined,
      { email, otp: '000000' },
      undefined,
      400,
    );
    await call('post', '/api/Auth/verify-register-otp', undefined, {
      email,
      otp: code,
    });
    const logged = await login(email);
    await call('post', '/api/Auth/request-reset-password', undefined, {
      email,
    });
    const reset = mail.sendOtpEmail.mock.calls
      .filter(([to]) => to === email)
      .at(-1)![1];
    await call('post', '/api/Auth/verify-reset-password', undefined, {
      email,
      otp: reset,
      newPassword: 'Changed_Test_2026!',
      confirmPassword: 'Changed_Test_2026!',
    });
    await call(
      'post',
      '/api/Auth/refresh-token',
      undefined,
      { refreshTokenKey: logged.refreshToken },
      undefined,
      401,
    );
    const relog = await result('post', '/api/Auth/login', undefined, {
      email,
      password: 'Changed_Test_2026!',
    });
    expect(relog.accessToken).toBeTruthy();
  });
  it('J06d long subscription -> contract -> sign -> PayOS -> activation; unsigned payment blocked', async () => {
    const f = await fixture();
    await db.subscriptionPackage.update({
      where: { id: f.pkg.id },
      data: { durationMonths: 3, durationDays: 90 },
    });
    const sub = await result(
      'post',
      '/api/MonthlySubscription/register',
      f.customer.accessToken,
      {
        packageId: f.pkg.id,
        vehicleId: f.vehicle.vehicleId,
        parkingId: f.parking.id,
        fixedSlotId: f.slot.id,
      },
    );
    expect(sub.requiresContract).toBe(true);
    await call(
      'post',
      '/api/MonthlySubscription/payment/' + sub.subscriptionId,
      f.customer.accessToken,
      { paymentMethod: 'PayOS' },
      undefined,
      409,
    );
    const contract = await result(
      'get',
      '/api/contracts/subscription/' + sub.subscriptionId,
      f.customer.accessToken,
    );
    const savedKey = process.env.CONTRACT_SIGNING_PRIVATE_KEY;
    process.env.CONTRACT_SIGNING_PRIVATE_KEY = generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
    })
      .privateKey.export({ type: 'pkcs8', format: 'pem' })
      .toString();
    try {
      const png = await sharp({
        create: { width: 64, height: 32, channels: 3, background: 'black' },
      })
        .png()
        .toBuffer();
      const signed = await result(
        'post',
        '/api/contracts/' + contract.contractId + '/sign',
        f.customer.accessToken,
        {
          agreed: true,
          signerName: 'Khách kiểm thử',
          contentHash: contract.contentHash,
          signatureImage: 'data:image/png;base64,' + png.toString('base64'),
          paymentMethod: 'PayOS',
        },
      );
      const payment = pick(signed, 'Payment');
      expect(payment?.paymentId).toBeTruthy();
      await pay(payment.paymentId);
      const synced = await result(
        'get',
        '/api/payments/' + payment.paymentId + '/sync',
        f.customer.accessToken,
      );
      expect(synced.isApplied).toBe(true);
      expect(
        (
          await db.monthlySubscription.findUniqueOrThrow({
            where: { id: sub.subscriptionId },
          })
        ).status,
      ).toBe('Active');
      const verify = await result(
        'get',
        '/api/contracts/' + contract.contractId + '/verify',
        f.customer.accessToken,
      );
      expect(verify).toBeTruthy();
    } finally {
      if (savedKey === undefined)
        delete process.env.CONTRACT_SIGNING_PRIVATE_KEY;
      else process.env.CONTRACT_SIGNING_PRIVATE_KEY = savedKey;
    }
  });
  it('J05c cancelled provider link -> concurrent recreate -> one new deposit obligation', async () => {
    const f = await fixture();
    const r = await result(
      'post',
      '/api/reservations',
      f.customer.accessToken,
      {
        vehicleId: f.vehicle.vehicleId,
        parkingId: f.parking.id,
        expectedEntryTime: new Date(Date.now() + 3600000).toISOString(),
      },
    );
    orders.get(r.orderCode)!.status = 'CANCELLED';
    await call(
      'get',
      '/api/payments/' + r.paymentId + '/sync',
      f.customer.accessToken,
    );
    const [a, b] = await Promise.all([
      result(
        'post',
        '/api/reservations/' + r.reservationId + '/recreate-payment',
        f.customer.accessToken,
      ),
      result(
        'post',
        '/api/reservations/' + r.reservationId + '/recreate-payment',
        f.customer.accessToken,
      ),
    ]);
    expect(a.paymentId).toBe(b.paymentId);
    expect(
      await db.payment.count({
        where: { reservationId: r.reservationId, paymentStatus: 'Pending' },
      }),
    ).toBe(1);
  });
  async function manager() {
    const role = await db.role.upsert({
      where: { roleName: 'manager' },
      create: { roleName: 'manager' },
      update: {},
    });
    const suffix = randomUUID().slice(0, 8);
    const actor = await db.user.create({
      data: {
        email: 'manager-' + suffix + '@example.test',
        userName: 'manager' + suffix,
        passwordHash,
        roleId: role.id,
      },
    });
    return login(actor.email);
  }
  it('J02b edit and delete unused vehicle; foreign access and active plate edits are blocked', async () => {
    const f = await fixture();
    const spare = await result(
      'post',
      '/api/vehicles',
      f.customer.accessToken,
      {
        vehicleTypeId: f.carType.id,
        licensePlate: '51K' + String(++plateSequence).padStart(5, '0'),
      },
    );
    const path = '/api/vehicles/' + spare.vehicleId;
    await call(
      'put',
      path,
      f.staff.accessToken,
      { nickname: 'Không được đổi' },
      undefined,
      404,
    );
    await call('delete', path, f.staff.accessToken, undefined, undefined, 404);
    const changed = await result('put', path, f.customer.accessToken, {
      nickname: 'Xe gia đình',
      modelName: 'Vios',
      licensePlate: '51L' + String(++plateSequence).padStart(5, '0'),
    });
    expect(changed.nickname).toBe('Xe gia đình');
    await call('delete', path, f.customer.accessToken);
    await call('get', path, f.customer.accessToken, undefined, undefined, 404);
    await enter(f);
    await call(
      'put',
      '/api/vehicles/' + f.vehicle.vehicleId,
      f.customer.accessToken,
      { licensePlate: '51M' + String(++plateSequence).padStart(5, '0') },
      undefined,
      409,
    );
    await call(
      'delete',
      '/api/vehicles/' + f.vehicle.vehicleId,
      f.customer.accessToken,
      undefined,
      undefined,
      409,
    );
    await call(
      'put',
      '/api/vehicles/' + f.vehicle.vehicleId,
      f.customer.accessToken,
      { nickname: 'Xe đang gửi' },
    );
  });
  it('J05d paid reservation changes time once; cancellation refunds exactly one deposit', async () => {
    const f = await fixture();
    const reservation = await result(
      'post',
      '/api/reservations',
      f.customer.accessToken,
      {
        vehicleId: f.vehicle.vehicleId,
        parkingId: f.parking.id,
        expectedEntryTime: new Date(Date.now() + 2 * 36e5).toISOString(),
      },
      randomUUID(),
    );
    await pay(reservation.paymentId);
    await call(
      'get',
      '/api/payments/' + reservation.paymentId + '/sync',
      f.customer.accessToken,
    );
    const path = '/api/reservations/' + reservation.reservationId;
    const expected = new Date(Date.now() + 3 * 36e5).toISOString();
    await call(
      'put',
      path + '/change-time',
      f.staff.accessToken,
      { newExpectedTime: expected },
      undefined,
      403,
    );
    const changed = await result(
      'put',
      path + '/change-time',
      f.customer.accessToken,
      { newExpectedTime: expected },
    );
    expect(changed.status).toBe('Modified');
    expect(new Date(changed.expectedEntryTime).getTime()).toBe(
      new Date(expected).getTime(),
    );
    await call(
      'put',
      path + '/change-time',
      f.customer.accessToken,
      { newExpectedTime: new Date(Date.now() + 4 * 36e5).toISOString() },
      undefined,
      400,
    );
    await call('put', path + '/cancel', f.customer.accessToken, {});
    const wallet = await db.wallet.findUniqueOrThrow({
      where: { id: f.wallet.walletId },
    });
    expect(wallet.balance.toNumber()).toBe(
      200000 + Number(reservation.depositAmount),
    );
    expect(
      await db.payment.count({
        where: { reservationId: reservation.reservationId },
      }),
    ).toBe(1);
    await call(
      'put',
      path + '/cancel',
      f.customer.accessToken,
      {},
      undefined,
      400,
    );
    expect(
      (
        await db.wallet.findUniqueOrThrow({ where: { id: f.wallet.walletId } })
      ).balance.toString(),
    ).toBe(wallet.balance.toString());
  });
  it('J07b promo validation and repeated top-up sync credit CASH/BONUS once', async () => {
    const f = await fixture();
    const promo = await db.promoCode.create({
      data: {
        code:
          'FLOW' + randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase(),
        minTopUp: 100000,
        bonusAmount: 10000,
        bonusValidDays: 7,
        maxUses: 1,
        startsAt: new Date(Date.now() - 60000),
        endsAt: new Date(Date.now() + 864e5),
      },
    });
    const available = await result(
      'get',
      '/api/PromoCode/available',
      f.customer.accessToken,
    );
    expect(available.some((p: any) => p.code === promo.code)).toBe(true);
    await call(
      'post',
      '/api/PromoCode/check',
      f.customer.accessToken,
      { code: promo.code, amount: 50000 },
      undefined,
      400,
    );
    await call('post', '/api/PromoCode/check', f.customer.accessToken, {
      code: promo.code,
      amount: 100000,
    });
    const topup = await result(
      'post',
      '/api/wallet/' + f.wallet.walletId + '/top-up',
      f.customer.accessToken,
      { amount: 100000, promoCode: promo.code },
      randomUUID(),
    );
    await pay(topup.paymentId);
    await Promise.all(
      [1, 2].map(() =>
        call(
          'get',
          '/api/payments/' + topup.paymentId + '/sync',
          f.customer.accessToken,
        ),
      ),
    );
    const wallet = await db.wallet.findUniqueOrThrow({
      where: { id: f.wallet.walletId },
    });
    expect(wallet.balance.toNumber()).toBe(300000);
    expect(wallet.bonusBalance.toNumber()).toBe(10000);
    expect(
      await db.promoRedemption.count({
        where: { userId: f.user.id, promoCodeId: promo.id },
      }),
    ).toBe(1);
    expect(
      (await db.promoCode.findUniqueOrThrow({ where: { id: promo.id } }))
        .usedCount,
    ).toBe(1);
    expect(
      await db.walletTransaction.count({
        where: { paymentId: topup.paymentId },
      }),
    ).toBe(2);
    await call(
      'post',
      '/api/PromoCode/check',
      f.customer.accessToken,
      { code: promo.code, amount: 100000 },
      undefined,
      400,
    );
  });
  it('J07c receipt PDF, concurrent invoice submit, issue and notification preserve ownership', async () => {
    const f = await fixture();
    const admin = await manager();
    const { sessionId } = await enter(f);
    await call(
      'post',
      '/api/ParkingSession/my/' + sessionId + '/prepay',
      f.customer.accessToken,
      { paymentMethod: 'Wallet' },
      randomUUID(),
    );
    const payment = await db.payment.findFirstOrThrow({
      where: { sessionId, paymentStatus: 'Success' },
    });
    const path = '/api/receipts/' + payment.id;
    const link = await result('get', path + '/link', f.customer.accessToken);
    const signed = new URL(link.url);
    const pdf = await request(app.getHttpServer())
      .get(signed.pathname + signed.search)
      .expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');
    await request(app.getHttpServer())
      .get(signed.pathname + '?exp=1&sig=' + 'f'.repeat(64))
      .expect(404);
    await request(app.getHttpServer())
      .get(signed.pathname + signed.search.replace(/sig=./, 'sig=x'))
      .expect(404);
    await call(
      'get',
      path + '/link',
      f.staff.accessToken,
      undefined,
      undefined,
      404,
    );
    const info = {
      companyName: 'Công ty Kiểm Thử',
      taxCode: '0312345678',
      address: 'Bãi local',
      email: 'invoice@example.test',
    };
    await call(
      'post',
      path + '/invoice-request',
      f.staff.accessToken,
      info,
      undefined,
      404,
    );
    const invoices = await Promise.all(
      [1, 2].map(() =>
        result('post', path + '/invoice-request', f.customer.accessToken, info),
      ),
    );
    expect(invoices[0].id).toBe(invoices[1].id);
    const invoiceId = invoices[0].id;
    await call(
      'get',
      '/api/receipts/invoice-requests?status=invalid',
      admin.accessToken,
      undefined,
      undefined,
      400,
    );
    expect(
      (
        await result(
          'get',
          '/api/receipts/invoice-requests?status=Pending',
          admin.accessToken,
        )
      ).some((i: any) => i.id === invoiceId),
    ).toBe(true);
    const updated = await result(
      'post',
      path + '/invoice-request',
      f.customer.accessToken,
      { ...info, companyName: 'Công ty Đã Sửa' },
    );
    expect(updated.companyName).toBe('Công ty Đã Sửa');
    await call(
      'get',
      '/api/receipts/invoice-requests',
      f.customer.accessToken,
      undefined,
      undefined,
      403,
    );
    await call(
      'put',
      '/api/receipts/invoice-requests/' + invoiceId,
      admin.accessToken,
      { invoiceNo: 'LOCAL-001' },
    );
    await call(
      'post',
      path + '/invoice-request',
      f.customer.accessToken,
      info,
      undefined,
      409,
    );
    const notifications = await result(
      'get',
      '/api/Notification/my',
      f.customer.accessToken,
    );
    expect(
      notifications.items.some(
        (n: any) => n.metadata?.invoiceRequestId === invoiceId,
      ),
    ).toBe(true);
  });
  it('J08b incident ownership, terminal states and notification read-all/delete are enforced', async () => {
    const f = await fixture(),
      other = await fixture();
    const { sessionId } = await enter(f);
    await call(
      'post',
      '/api/IncidentReport',
      other.customer.accessToken,
      {
        sessionId,
        issueType: 'SlotOccupied',
        description: 'Không sở hữu phiên',
      },
      undefined,
      404,
    );
    const incident = await result(
      'post',
      '/api/IncidentReport',
      f.customer.accessToken,
      { sessionId, issueType: 'SlotOccupied', description: 'Ô đỗ có vật cản' },
    );
    const path = '/api/IncidentReport/' + incident.incidentId;
    await call(
      'get',
      path,
      other.customer.accessToken,
      undefined,
      undefined,
      403,
    );
    await call(
      'put',
      path + '/cancel',
      other.customer.accessToken,
      {},
      undefined,
      403,
    );
    const staffId = f.staff.user.userId;
    await call(
      'put',
      path + '/resolve/' + other.staff.user.userId,
      f.staff.accessToken,
      { resolutionNotes: 'Không được mạo danh nhân viên khác' },
      undefined,
      403,
    );
    await call(
      'put',
      path + '/assign/' + f.user.id,
      f.staff.accessToken,
      {},
      undefined,
      400,
    );
    await call('put', path + '/assign/' + staffId, f.staff.accessToken, {});
    await call('put', path + '/resolve/' + staffId, f.staff.accessToken, {
      resolutionNotes: 'Đã giải phóng ô',
    });
    await call(
      'put',
      path + '/cancel',
      f.customer.accessToken,
      {},
      undefined,
      400,
    );
    await call(
      'put',
      path + '/assign/' + staffId,
      f.staff.accessToken,
      {},
      undefined,
      409,
    );
    await call(
      'put',
      path + '/resolve/' + staffId,
      f.staff.accessToken,
      { resolutionNotes: 'Không được lặp' },
      undefined,
      409,
    );
    const mine = await result(
      'get',
      '/api/Notification/my',
      f.customer.accessToken,
    );
    const notification = mine.items.find(
      (n: any) => n.metadata?.incidentId === incident.incidentId,
    );
    expect(notification).toBeTruthy();
    expect(notification.message).not.toContain('SlotOccupied');
    await call(
      'put',
      '/api/Notification/' + notification.id + '/read',
      other.customer.accessToken,
      {},
      undefined,
      404,
    );
    await call(
      'delete',
      '/api/Notification/' + notification.id,
      other.customer.accessToken,
      undefined,
      undefined,
      404,
    );
    await call(
      'put',
      '/api/Notification/' + notification.id + '/read',
      f.customer.accessToken,
      {},
    );
    await call('put', '/api/Notification/read-all', f.customer.accessToken, {});
    expect(
      (await result('get', '/api/Notification/my', f.customer.accessToken))
        .unreadCount,
    ).toBe(0);
    await call(
      'delete',
      '/api/Notification/' + notification.id,
      f.customer.accessToken,
    );
    expect(
      (
        await result(
          'get',
          '/api/IncidentReport/my-reports',
          f.customer.accessToken,
        )
      ).some((i: any) => i.incidentId === incident.incidentId),
    ).toBe(true);
  });
  it('J08c concurrent cancel/resolve chooses one terminal outcome', async () => {
    const f = await fixture();
    const incident = await result(
      'post',
      '/api/IncidentReport',
      f.customer.accessToken,
      { issueType: 'Other', description: 'Kiểm thử tranh chấp' },
    );
    const path = '/api/IncidentReport/' + incident.incidentId;
    const responses = await Promise.all([
      request(app.getHttpServer())
        .put(path + '/cancel')
        .set('Authorization', 'Bearer ' + f.customer.accessToken)
        .send({}),
      request(app.getHttpServer())
        .put(path + '/resolve/' + f.staff.user.userId)
        .set('Authorization', 'Bearer ' + f.staff.accessToken)
        .send({ resolutionNotes: 'Đã kiểm tra' }),
    ]);
    expect(responses.filter((r) => r.body.isSuccess)).toHaveLength(1);
    expect(['Cancelled', 'Resolved']).toContain(
      (
        await db.incidentReport.findUniqueOrThrow({
          where: { id: incident.incidentId },
        })
      ).status,
    );
  });
  it('J07d issuing an invoice races with edits without changing the issued snapshot', async () => {
    const f = await fixture();
    const admin = await manager();
    const registered = await result(
      'post',
      '/api/MonthlySubscription/register',
      f.customer.accessToken,
      {
        packageId: f.pkg.id,
        vehicleId: f.vehicle.vehicleId,
        parkingId: f.parking.id,
        fixedSlotId: f.slot.id,
        paymentMethod: 'Wallet',
      },
      randomUUID(),
    );
    const payment = await db.payment.findFirstOrThrow({
      where: {
        userId: f.user.id,
        paymentStatus: 'Success',
        paymentType: 'SubscriptionFee',
      },
    });
    const path = '/api/receipts/' + payment.id + '/invoice-request';
    const info = {
      companyName: 'Thông tin ban đầu',
      taxCode: '0312345678',
      address: 'Bãi local',
      email: 'invoice@example.test',
    };
    const invoice = await result('post', path, f.customer.accessToken, info);
    const requests = [
      request(app.getHttpServer())
        .post(path)
        .set('Authorization', 'Bearer ' + f.customer.accessToken)
        .send({ ...info, companyName: 'Công ty cập nhật A' }),
      request(app.getHttpServer())
        .put('/api/receipts/invoice-requests/' + invoice.id)
        .set('Authorization', 'Bearer ' + admin.accessToken)
        .send({ invoiceNo: 'LOCAL-RACE' }),
      request(app.getHttpServer())
        .post(path)
        .set('Authorization', 'Bearer ' + f.customer.accessToken)
        .send({ ...info, companyName: 'Công ty cập nhật B' }),
    ];
    const responses = await Promise.all(requests);
    expect(responses[1].status).toBe(200);
    for (const response of [responses[0], responses[2]])
      expect([200, 409]).toContain(response.status);
    const final = await db.invoiceRequest.findUniqueOrThrow({
      where: { id: invoice.id },
    });
    expect(final.status).toBe('Issued');
    expect(final.companyName).toBe(responses[1].body.result.companyName);
    expect(final.invoiceNo).toBe('LOCAL-RACE');
    expect(registered.subscriptionId).toBeTruthy();
  });
  it('J05e paid reservation -> staff inspection -> check-in -> zero remaining checkout -> completed history', async () => {
    const f = await fixture();
    const reservation = await result(
      'post',
      '/api/reservations',
      f.customer.accessToken,
      {
        vehicleId: f.vehicle.vehicleId,
        parkingId: f.parking.id,
        expectedEntryTime: new Date(Date.now() + 20 * 60000).toISOString(),
      },
      randomUUID(),
    );
    await pay(reservation.paymentId);
    await result(
      'get',
      '/api/payments/' + reservation.paymentId + '/sync',
      f.customer.accessToken,
    );
    const confirmed = await result(
      'get',
      '/api/reservations/' + reservation.reservationId,
      f.staff.accessToken,
    );
    expect(confirmed.status).toBe('Confirmed');
    const scan = await scanPlate(f, f.entry.id, 'Reservation');
    expect(scan.match.reservation.reservationId).toBe(
      reservation.reservationId,
    );
    const entered = await result(
      'post',
      '/api/ParkingOperation/check-in',
      f.staff.accessToken,
      {
        gateId: f.entry.id,
        customerType: 'Reservation',
        reservationId: reservation.reservationId,
        licensePlate: f.vehicle.licensePlate,
      },
    );
    const sessionId = pick(entered, 'Session')?.sessionId ?? entered.sessionId;
    expect(sessionId).toBeTruthy();
    const staffView = await result(
      'get',
      '/api/ParkingSession/' + sessionId,
      f.staff.accessToken,
    );
    expect(staffView).toMatchObject({
      status: 'Active',
      vehicleId: f.vehicle.vehicleId,
      reservationId: reservation.reservationId,
    });
    const customerSessions = await result(
      'get',
      '/api/ParkingSession/my',
      f.customer.accessToken,
    );
    expect(customerSessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sessionId, status: 'Active' }),
      ]),
    );
    const fee = await result(
      'get',
      '/api/ParkingSession/my/' + sessionId + '/fee-preview',
      f.customer.accessToken,
    );
    expect(fee.remainingAmount).toBe(0);
    const checkout = await result(
      'post',
      '/api/ParkingOperation/check-out',
      f.staff.accessToken,
      {
        gateId: f.exit.id,
        sessionId,
        licensePlateOut: f.vehicle.licensePlate,
      },
    );
    expect(pick(checkout, 'Session')?.status ?? checkout.status).toBe(
      'Completed',
    );
    const final = await result(
      'get',
      '/api/ParkingSession/' + sessionId,
      f.staff.accessToken,
    );
    expect(final.status).toBe('Completed');
    expect(
      (
        await db.reservation.findUniqueOrThrow({
          where: { id: reservation.reservationId },
        })
      ).status,
    ).toBe('Completed');
    expect(
      (
        await db.parkingSlot.findUniqueOrThrow({
          where: { id: final.actualSlotId },
        })
      ).status,
    ).toBe('Available');
    expect(
      await db.payment.count({
        where: { sessionId, paymentType: 'CheckoutFee' },
      }),
    ).toBe(0);
    await call(
      'post',
      '/api/ParkingOperation/check-out',
      f.staff.accessToken,
      {
        gateId: f.exit.id,
        sessionId,
        licensePlateOut: f.vehicle.licensePlate,
      },
      undefined,
      404,
    );
    const history = await result(
      'get',
      '/api/payments/my?page=1&pageSize=20',
      f.customer.accessToken,
    );
    expect(
      history.items.filter((p: any) => p.paymentId === reservation.paymentId),
    ).toHaveLength(1);
  });

  it('J06e monthly activation -> old pass preserved -> staff checks session -> included checkout -> fixed slot retained', async () => {
    const f = await fixture();
    const oldPass = await result(
      'post',
      '/api/entry-passes',
      f.customer.accessToken,
      { vehicleId: f.vehicle.vehicleId, parkingId: f.parking.id },
    );
    const sub = await result(
      'post',
      '/api/MonthlySubscription/register',
      f.customer.accessToken,
      {
        packageId: f.pkg.id,
        vehicleId: f.vehicle.vehicleId,
        parkingId: f.parking.id,
        fixedSlotId: f.slot.id,
        paymentMethod: 'Wallet',
      },
    );
    const gateIn = await db.gate.create({
      data: {
        floorId: f.resident.id,
        gateName: 'Resident in',
        gateType: 'Entry',
      },
    });
    const gateOut = await db.gate.create({
      data: {
        floorId: f.resident.id,
        gateName: 'Resident out',
        gateType: 'Exit',
      },
    });
    const residentScan = await scanPlate(f, gateIn.id, 'Resident');
    expect(residentScan.match.subscription.subscriptionId).toBe(
      sub.subscriptionId,
    );
    const entered = await result(
      'post',
      '/api/ParkingOperation/check-in',
      f.staff.accessToken,
      {
        gateId: gateIn.id,
        qrPayload: oldPass.qrPayload,
        licensePlate: f.vehicle.licensePlate,
      },
    );
    const sessionId = pick(entered, 'Session')?.sessionId ?? entered.sessionId;
    expect(sessionId).toBeTruthy();
    const staffView = await result(
      'get',
      '/api/ParkingSession/' + sessionId,
      f.staff.accessToken,
    );
    expect(staffView).toMatchObject({
      status: 'Active',
      vehicleId: f.vehicle.vehicleId,
      actualSlotId: f.slot.id,
    });
    const passes = await result(
      'get',
      '/api/entry-passes/my',
      f.customer.accessToken,
    );
    expect(
      passes.find((p: any) => p.qrPayload === oldPass.qrPayload)?.status,
    ).toBe('Active');
    const fee = await result(
      'get',
      '/api/ParkingSession/my/' + sessionId + '/fee-preview',
      f.customer.accessToken,
    );
    expect(fee.remainingAmount ?? fee.amount).toBe(0);
    const checkout = await result(
      'post',
      '/api/ParkingOperation/check-out',
      f.staff.accessToken,
      {
        gateId: gateOut.id,
        sessionId,
        licensePlateOut: f.vehicle.licensePlate,
      },
    );
    expect(pick(checkout, 'Session')?.status ?? checkout.status).toBe(
      'Completed',
    );
    const final = await result(
      'get',
      '/api/ParkingSession/' + sessionId,
      f.staff.accessToken,
    );
    expect(final.status).toBe('Completed');
    expect(
      (await db.parkingSlot.findUniqueOrThrow({ where: { id: f.slot.id } }))
        .status,
    ).toBe('Assigned');
    expect(
      (
        await db.monthlySubscription.findUniqueOrThrow({
          where: { id: sub.subscriptionId },
        })
      ).status,
    ).toBe('Active');
    expect(await db.payment.count({ where: { sessionId } })).toBe(0);
    const sessions = await result(
      'get',
      '/api/ParkingSession/my',
      f.customer.accessToken,
    );
    expect(sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sessionId, status: 'Completed' }),
      ]),
    );
  });
  it('J03c motorcycle floor capacity -> concurrent entry -> wallet exit -> waiting bike can retry', async () => {
    const f = await fixture();
    const type = await db.vehicleType.upsert({
      where: { typeName: 'Xe máy' },
      create: { typeName: 'Xe máy' },
      update: {},
    });
    const floor = await db.floor.create({
      data: {
        parkingId: f.parking.id,
        floorName: 'Bike capacity ' + randomUUID(),
        dedicatedVehicleTypeId: type.id,
        totalCapacity: 1,
      },
    });
    const gateIn = await db.gate.create({
      data: { floorId: floor.id, gateName: 'Bike entry', gateType: 'Entry' },
    });
    const gateOut = await db.gate.create({
      data: { floorId: floor.id, gateName: 'Bike exit', gateType: 'Exit' },
    });
    await db.pricingPolicy.upsert({
      where: { id: '11111111-1111-4111-8111-111111111102' },
      create: {
        id: '11111111-1111-4111-8111-111111111102',
        vehicleTypeId: type.id,
        basePrice: 5000,
        baseHours: 1,
        extraHourPrice: 2000,
        nightSurcharge: 0,
        effectiveDate: new Date('2020-01-01T00:00:00Z'),
      },
      update: {},
    });
    const bikes = [];
    const passes = [];
    for (let i = 0; i < 2; i++) {
      bikes.push(
        await result('post', '/api/vehicles', f.customer.accessToken, {
          vehicleTypeId: type.id,
          licensePlate: '59M' + String(++plateSequence).padStart(5, '0'),
        }),
      );
      passes.push(
        await result('post', '/api/entry-passes', f.customer.accessToken, {
          vehicleId: bikes[i].vehicleId,
          parkingId: f.parking.id,
        }),
      );
    }
    const scan = await scanPlate(
      { ...f, vehicle: bikes[0] },
      gateIn.id,
      'EntryPass',
    );
    expect(scan.match.entryPass.entryPassId).toBe(passes[0].entryPassId);
    const responses = await Promise.all(
      passes.map((pass) =>
        request(app.getHttpServer())
          .post('/api/ParkingOperation/check-in')
          .set('Authorization', 'Bearer ' + f.staff.accessToken)
          .send({ gateId: gateIn.id, qrPayload: pass.qrPayload }),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    const winnerIndex = responses.findIndex((r) => r.status === 201);
    const loserIndex = 1 - winnerIndex;
    const winnerSession = responses[winnerIndex].body.result;
    const winnerId =
      pick(winnerSession, 'Session')?.sessionId ?? winnerSession.sessionId;
    const availability = async () => {
      const rows = await result(
        'get',
        '/api/ParkingOperation/availability?vehicleTypeId=' + type.id,
        f.staff.accessToken,
      );
      return rows.find((r: any) => r.floorId === floor.id);
    };
    expect(await availability()).toMatchObject({
      totalSlots: 1,
      availableSlots: 0,
      occupiedSlots: 1,
    });
    expect(
      (
        await db.entryPass.findUniqueOrThrow({
          where: { id: passes[loserIndex].entryPassId },
        })
      ).status,
    ).toBe('Active');
    const exitBike = async (sessionId: string, plate: string) => {
      const staffSession = await result(
        'get',
        '/api/ParkingSession/' + sessionId,
        f.staff.accessToken,
      );
      expect(staffSession).toMatchObject({
        status: 'Active',
        actualSlotId: null,
        licensePlateIn: plate,
      });
      const fee = await result(
        'get',
        '/api/ParkingSession/my/' + sessionId + '/fee-preview',
        f.customer.accessToken,
      );
      expect(fee.remainingAmount).toBe(5000);
      await result(
        'post',
        '/api/ParkingSession/my/' + sessionId + '/prepay',
        f.customer.accessToken,
        { paymentMethod: 'Wallet' },
        randomUUID(),
      );
      await result(
        'post',
        '/api/ParkingOperation/check-out',
        f.staff.accessToken,
        { gateId: gateOut.id, sessionId, licensePlateOut: plate },
      );
      expect(
        (
          await result(
            'get',
            '/api/ParkingSession/' + sessionId,
            f.staff.accessToken,
          )
        ).status,
      ).toBe('Completed');
    };
    await exitBike(winnerId, bikes[winnerIndex].licensePlate);
    expect(await availability()).toMatchObject({
      totalSlots: 1,
      availableSlots: 1,
      occupiedSlots: 0,
    });
    const retry = await result(
      'post',
      '/api/ParkingOperation/check-in',
      f.staff.accessToken,
      { gateId: gateIn.id, qrPayload: passes[loserIndex].qrPayload },
    );
    const retryId = pick(retry, 'Session')?.sessionId ?? retry.sessionId;
    await exitBike(retryId, bikes[loserIndex].licensePlate);
    expect(await availability()).toMatchObject({
      availableSlots: 1,
      occupiedSlots: 0,
    });
    expect(await db.parkingSlot.count({ where: { floorId: floor.id } })).toBe(
      0,
    );
    expect(
      (
        await db.wallet.findUniqueOrThrow({ where: { id: f.wallet.walletId } })
      ).balance.toNumber(),
    ).toBe(190000);
    expect(
      await db.payment.count({
        where: {
          sessionId: { in: [winnerId, retryId] },
          paymentStatus: 'Success',
        },
      }),
    ).toBe(2);
  });

  it('J03d unregistered walk-in -> staff fee -> cash confirmation -> slot and cash audit complete', async () => {
    const f = await fixture();
    const plate = '51W' + String(++plateSequence).padStart(5, '0');
    const scan = await scanPlate(
      { ...f, vehicle: { ...f.vehicle, licensePlate: plate } },
      f.entry.id,
      'Guest',
    );
    expect(scan.match.vehicle).toBeNull();
    const entered = await result(
      'post',
      '/api/ParkingOperation/check-in',
      f.staff.accessToken,
      {
        gateId: f.entry.id,
        customerType: 'Guest',
        licensePlate: plate,
        vehicleTypeId: f.carType.id,
      },
    );
    const sessionId = pick(entered, 'Session')?.sessionId ?? entered.sessionId;
    const session = await result(
      'get',
      '/api/ParkingSession/' + sessionId,
      f.staff.accessToken,
    );
    expect(session).toMatchObject({
      status: 'Active',
      vehicleId: null,
      licensePlateIn: plate,
    });
    expect(
      (
        await db.parkingSlot.findUniqueOrThrow({
          where: { id: session.actualSlotId },
        })
      ).status,
    ).toBe('Occupied');
    await result(
      'get',
      '/api/ParkingOperation/fee-preview/' + sessionId,
      f.staff.accessToken,
    );
    const exitScan = await scanPlate(
      { ...f, vehicle: { ...f.vehicle, licensePlate: plate } },
      f.exit.id,
      'Checkout',
    );
    expect(exitScan.match.activeSession.sessionId).toBe(sessionId);
    const checkout = await result(
      'post',
      '/api/ParkingOperation/check-out',
      f.staff.accessToken,
      {
        gateId: f.exit.id,
        sessionId,
        licensePlateOut: plate,
        paymentMethod: 'Cash',
      },
    );
    const paymentId = pick(checkout, 'Payment').paymentId;
    expect(
      (await db.parkingSession.findUniqueOrThrow({ where: { id: sessionId } }))
        .status,
    ).toBe('Active');
    const confirms = await Promise.all(
      [0, 1].map(() =>
        request(app.getHttpServer())
          .post(
            '/api/ParkingOperation/check-out/payment/' +
              paymentId +
              '/confirm-cash',
          )
          .set('Authorization', 'Bearer ' + f.staff.accessToken)
          .send({}),
      ),
    );
    expect(confirms.map((r) => r.status)).toEqual([200, 200]);
    expect(confirms.every((r) => r.body.isSuccess)).toBe(true);
    const final = await result(
      'get',
      '/api/ParkingSession/' + sessionId,
      f.staff.accessToken,
    );
    expect(final.status).toBe('Completed');
    expect(
      (
        await db.parkingSlot.findUniqueOrThrow({
          where: { id: session.actualSlotId },
        })
      ).status,
    ).toBe('Available');
    const payment = await db.payment.findUniqueOrThrow({
      where: { id: paymentId },
    });
    expect(payment).toMatchObject({
      paymentStatus: 'Success',
      userId: null,
      collectedById: f.staffUser.id,
      collectedGateId: f.exit.id,
    });
    expect(payment.appliedAt).not.toBeNull();
    expect(await db.payment.count({ where: { sessionId } })).toBe(1);
    expect(
      (
        await db.wallet.findUniqueOrThrow({ where: { id: f.wallet.walletId } })
      ).balance.toNumber(),
    ).toBe(200000);
    await call(
      'post',
      '/api/ParkingOperation/check-out',
      f.staff.accessToken,
      { gateId: f.exit.id, sessionId, licensePlateOut: plate },
      undefined,
      404,
    );
  });

  it('J03e wrong parking or exit plate preserves paid session; correct exit completes once', async () => {
    const f = await fixture();
    const { sessionId } = await enter(f);
    await result(
      'post',
      '/api/ParkingSession/my/' + sessionId + '/prepay',
      f.customer.accessToken,
      { paymentMethod: 'Wallet' },
      randomUUID(),
    );
    const permit = await result(
      'get',
      '/api/ParkingSession/my/' + sessionId + '/exit-pass',
      f.customer.accessToken,
    );
    const other = await db.parking.create({
      data: { name: 'Other exit ' + randomUUID(), location: 'Local test' },
    });
    const otherFloor = await db.floor.create({
      data: {
        parkingId: other.id,
        floorName: 'Other exit',
        dedicatedVehicleTypeId: f.carType.id,
        totalCapacity: 1,
      },
    });
    const wrongExit = await db.gate.create({
      data: {
        floorId: otherFloor.id,
        gateName: 'Other parking exit',
        gateType: 'Exit',
      },
    });
    await call(
      'post',
      '/api/ParkingOperation/check-out',
      f.staff.accessToken,
      {
        gateId: wrongExit.id,
        sessionId,
        licensePlateOut: f.vehicle.licensePlate,
      },
      undefined,
      409,
    );
    await call(
      'post',
      '/api/ParkingOperation/check-out',
      f.staff.accessToken,
      { gateId: f.exit.id, sessionId, licensePlateOut: '51Z99999' },
      undefined,
      409,
    );
    const waiting = await db.parkingSession.findUniqueOrThrow({
      where: { id: sessionId },
    });
    expect(waiting).toMatchObject({
      status: 'Active',
      exitGateId: null,
      exitTime: null,
    });
    expect(
      (
        await db.parkingSlot.findUniqueOrThrow({
          where: { id: waiting.actualSlotId! },
        })
      ).status,
    ).toBe('Occupied');
    const unchanged = await result(
      'get',
      '/api/ParkingSession/my/' + sessionId + '/exit-pass',
      f.customer.accessToken,
    );
    expect(pick(unchanged, 'ExitPass').code).toBe(
      pick(permit, 'ExitPass').code,
    );
    await result(
      'post',
      '/api/ParkingOperation/check-out',
      f.staff.accessToken,
      { gateId: f.exit.id, sessionId, licensePlateOut: f.vehicle.licensePlate },
    );
    expect(
      (
        await result(
          'get',
          '/api/ParkingSession/' + sessionId,
          f.staff.accessToken,
        )
      ).status,
    ).toBe('Completed');
    expect(
      await db.payment.count({
        where: { sessionId, paymentStatus: 'Success' },
      }),
    ).toBe(1);
    expect(
      (
        await db.parkingSlot.findUniqueOrThrow({
          where: { id: waiting.actualSlotId! },
        })
      ).status,
    ).toBe('Available');
  });
});
