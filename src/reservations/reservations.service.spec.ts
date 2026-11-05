import { AppError } from '../common/errors';
import { Prisma } from '@prisma/client';
import { resetLegacyColumnsCache } from '../common/legacy-columns';
import { PayosService } from '../integrations/payos-files.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { WalletsService } from '../wallets/wallets.service';
import { ReservationsService } from './reservations.service';

const userId = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
const otherUser = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const vehicleId = '6e2c1c43-5d8a-4b7e-9a39-0f6c4f2d8b22';
const parkingId = '1f0e0d0c-0b0a-4900-8800-777766665555';
const inMinutes = (m: number) => new Date(Date.now() + m * 60_000);
const paidDeposit = {
  id: 'pay-1',
  userId,
  amount: new Prisma.Decimal(30000),
  paymentStatus: 'Success',
};

function setup() {
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: jest.fn(),
    vehicleType: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'car-a', typeName: 'Ô tô' },
        { id: 'car-b', typeName: 'ô tô' },
        { id: 'bike', typeName: 'Xe máy' },
      ]),
      findFirst: jest.fn().mockResolvedValue({ id: 'car-a' }),
    },
    floor: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          {
            totalCapacity: 40,
            dedicatedVehicleTypeId: 'car-a',
            _count: { parkingSlots: 0 },
          },
        ]),
    },
    parking: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: parkingId, name: 'Bãi Quận 1' }),
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: parkingId, name: 'Bãi Quận 1' }]),
    },
    vehicle: {
      findFirst: jest.fn().mockResolvedValue({
        id: vehicleId,
        licensePlate: '51H12345',
        vehicleTypeId: 'car-a',
        vehicleType: { typeName: 'Ô tô' },
      }),
      findUnique: jest.fn().mockResolvedValue({ vehicleTypeId: 'car-a' }),
    },
    parkingSession: { findFirst: jest.fn().mockResolvedValue(null) },
    pricingPolicy: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ basePrice: new Prisma.Decimal(30000) }),
    },
    reservation: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve({
          id: where.id,
          userId,
          vehicleId,
          parkingId,
          expectedEntryTime: inMinutes(60),
          status: 'Pending',
          createdAt: new Date(),
          user: { fullName: 'Khách A' },
          parking: { name: 'Bãi Quận 1' },
          vehicle: {
            licensePlate: '51H12345',
            vehicleTypeId: 'car-a',
            vehicleType: { typeName: 'Ô tô' },
            user: { id: userId, fullName: 'Khách A' },
          },
        }),
      ),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'r-new', ...data }),
      ),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    payment: {
      create: jest
        .fn()
        .mockResolvedValue({
          id: 'pay-new',
          amount: new Prisma.Decimal(30000),
          paymentType: 'Deposit',
        }),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => unknown) =>
    fn(prisma),
  );
  const payos = {
    createPaymentLink: jest
      .fn()
      .mockResolvedValue({
        paymentLinkId: 'pl-1',
        paymentUrl: 'https://pay.os/x',
        orderCode: '1730',
      }),
    cancelPaymentLink: jest.fn().mockResolvedValue(undefined),
  };
  const wallets = { creditRefund: jest.fn().mockResolvedValue(true) };
  const notifications = { notify: jest.fn().mockResolvedValue(undefined) };
  const service = new ReservationsService(
    prisma as unknown as PrismaService,
    payos as unknown as PayosService,
    notifications as unknown as NotificationsService,
    wallets as unknown as WalletsService,
  );
  return { service, prisma, payos, wallets, notifications };
}

type Ctx = ReturnType<typeof setup>;
let ctx: Ctx;
beforeEach(() => {
  resetLegacyColumnsCache();
  ctx = setup();
});

describe('sức chứa vãng lai theo bãi', () => {
  it('tầng ô tô chưa sinh ô riêng vẫn tính theo sức chứa của tầng, chỉ tầng của bãi đó', async () => {
    ctx.prisma.floor.findMany.mockResolvedValue([
      {
        totalCapacity: 40,
        dedicatedVehicleTypeId: 'car-a',
        _count: { parkingSlots: 0 },
      },
      {
        totalCapacity: 200,
        dedicatedVehicleTypeId: 'bike',
        _count: { parkingSlots: 0 },
      },
    ]);
    const r = await ctx.service.walkInCapacity('car-a', 'Ô tô', parkingId);
    expect(r.capacity).toBe(40);
    expect(ctx.prisma.floor.findMany.mock.calls[0][0].where).toEqual({
      isResident: false,
      parkingId,
    });
  });

  it('tầng có ô riêng thì đếm ô; gộp các loại xe trùng tên "Ô tô"', async () => {
    ctx.prisma.floor.findMany.mockResolvedValue([
      {
        totalCapacity: 50,
        dedicatedVehicleTypeId: 'car-b',
        _count: { parkingSlots: 12 },
      },
    ]);
    const r = await ctx.service.walkInCapacity('car-a', 'Ô tô');
    expect(r.capacity).toBe(12);
    expect(r.typeIds.sort()).toEqual(['car-a', 'car-b']);
  });
});

describe('tạo đặt chỗ', () => {
  const body = (over: Record<string, unknown> = {}) => ({
    vehicleId,
    parkingId,
    expectedEntryTime: inMinutes(60).toISOString(),
    ...over,
  });

  it('giữ suất trong transaction có khoá theo bãi, gắn bãi, tạo cọc và trả hạn trả cọc 15 phút', async () => {
    const res = await ctx.service.create(userId, body());
    expect(res.statusCode).toBe(200);
    // Khoá theo bãi chạy trước khi đếm hạn mức.
    const lockSql = ctx.prisma.$queryRaw.mock.calls.find(
      (c) =>
        String(c[0]).includes('pg_advisory_xact_lock') &&
        c[1] === `reservation:${parkingId}`,
    );
    expect(lockSql?.[1]).toBe(`reservation:${parkingId}`);
    expect(ctx.prisma.reservation.create.mock.calls[0][0].data).toMatchObject({
      userId,
      vehicleId,
      parkingId,
      status: 'Pending',
    });
    expect(ctx.prisma.payment.create.mock.calls[0][0].data).toMatchObject({
      paymentType: 'Deposit',
      paymentStatus: 'Pending',
    });
    const result = res.result as {
      holdExpiresAt: Date;
      parkingName: string;
      paymentUrl: string;
    };
    expect(result.parkingName).toBe('Bãi Quận 1');
    expect(result.paymentUrl).toBe('https://pay.os/x');
    expect(result.holdExpiresAt.getTime() - Date.now()).toBeGreaterThan(
      14 * 60_000,
    );
  });

  it('hạn mức đếm đơn đã cọc và đơn chờ cọc còn hạn, theo khung giờ chồng nhau', async () => {
    await ctx.service.create(userId, body());
    const where = ctx.prisma.reservation.count.mock.calls[0][0].where;
    expect(where.parkingId).toBe(parkingId);
    expect(where.expectedEntryTime.gt).toBeInstanceOf(Date);
    expect(where.OR).toEqual([
      { status: { in: ['Confirmed', 'Modified'] } },
      { status: 'Pending', createdAt: { gte: expect.any(Date) } },
    ]);
  });

  it('hết suất quanh giờ đó: báo 409, không tạo đơn, không tạo link', async () => {
    ctx.prisma.reservation.count.mockResolvedValue(8); // 20% của 40 chỗ
    const res = await ctx.service.create(userId, body());
    expect(res.statusCode).toBe(409);
    expect(res.message).toContain('hết suất đặt trước');
    expect(ctx.prisma.reservation.create).not.toHaveBeenCalled();
    expect(ctx.payos.createPaymentLink).not.toHaveBeenCalled();
  });

  it('xe đã có đơn đã cọc thì không đặt thêm', async () => {
    ctx.prisma.reservation.findFirst.mockResolvedValue({
      id: 'r-old',
      status: 'Confirmed',
      expectedEntryTime: inMinutes(30),
    });
    const res = await ctx.service.create(userId, body());
    expect(res.statusCode).toBe(409);
    expect(ctx.prisma.reservation.create).not.toHaveBeenCalled();
  });

  it('đơn Pending khác giờ phải xử lý trước, không tự hủy để tạo nghĩa vụ cọc mới', async () => {
    ctx.prisma.reservation.findFirst.mockResolvedValue({
      id: 'r-old',
      status: 'Pending',
      createdAt: new Date(),
      expectedEntryTime: inMinutes(30),
      parkingId,
    });
    const res = await ctx.service.create(userId, body());
    expect(res.statusCode).toBe(409);
    expect(ctx.prisma.reservation.create).not.toHaveBeenCalled();
    expect(ctx.payos.cancelPaymentLink).not.toHaveBeenCalled();
  });

  it('xe đang trong bãi thì không đặt chỗ', async () => {
    ctx.prisma.parkingSession.findFirst.mockResolvedValue({ id: 's1' });
    expect((await ctx.service.create(userId, body())).statusCode).toBe(409);
  });

  it('hệ thống có nhiều bãi mà không chọn bãi thì báo chọn bãi', async () => {
    ctx.prisma.parking.findMany.mockResolvedValue([
      { id: parkingId, name: 'A' },
      { id: 'p2', name: 'B' },
    ]);
    const res = await ctx.service.create(
      userId,
      body({ parkingId: undefined }),
    );
    expect(res.isSuccess).toBe(false);
    expect(res.message).toContain('chọn bãi');
  });

  it('PayOS timeout giữ đơn Pending để truy vấn/đối soát, không suy đoán thất bại', async () => {
    ctx.payos.createPaymentLink.mockRejectedValue(
      new AppError(504, 'UPSTREAM_TIMEOUT', 'Chưa xác định kết quả PayOS'),
    );
    const res = await ctx.service.create(userId, body());
    expect(res.statusCode).toBe(504);
    expect(ctx.prisma.reservation.updateMany).not.toHaveBeenCalled();
    expect(ctx.prisma.payment.updateMany).not.toHaveBeenCalled();
  });

  it('chỉ nhận ô tô, giờ vào trong 5 tiếng', async () => {
    expect(
      (
        await ctx.service.create(
          userId,
          body({ expectedEntryTime: inMinutes(301).toISOString() }),
        )
      ).message,
    ).toContain('5 tiếng');
    ctx.prisma.vehicle.findFirst.mockResolvedValue({
      id: vehicleId,
      licensePlate: '59X112345',
      vehicleTypeId: 'bike',
      vehicleType: { typeName: 'Xe máy' },
    });
    expect((await ctx.service.create(userId, body())).message).toContain(
      'ô tô',
    );
  });
});

describe('đổi giờ', () => {
  const confirmed = (over: Record<string, unknown> = {}) => ({
    id: 'r1',
    userId,
    parkingId,
    status: 'Confirmed',
    expectedEntryTime: inMinutes(60),
    ...over,
  });

  it('người khác không đổi được giờ đơn của mình', async () => {
    ctx.prisma.reservation.findUnique.mockResolvedValue(confirmed());
    const res = await ctx.service.changeTime('r1', otherUser, {
      newExpectedTime: inMinutes(90).toISOString(),
    });
    expect(res.statusCode).toBe(403);
    expect(ctx.prisma.reservation.updateMany).not.toHaveBeenCalled();
  });

  it('chủ đơn đổi một lần: kiểm hạn mức giờ mới (bỏ qua chính đơn này), chuyển Modified', async () => {
    ctx.prisma.reservation.findUnique.mockResolvedValue(confirmed());
    const res = await ctx.service.changeTime('r1', userId, {
      newExpectedTime: inMinutes(90).toISOString(),
    });
    expect(res.statusCode).toBe(200);
    expect(ctx.prisma.reservation.count.mock.calls[0][0].where.NOT).toEqual({
      id: 'r1',
    });
    expect(ctx.prisma.reservation.updateMany).toHaveBeenCalledWith({
      where: { id: 'r1', status: 'Confirmed' },
      data: { expectedEntryTime: expect.any(Date), status: 'Modified' },
    });
  });

  it('đã đổi một lần thì không đổi nữa', async () => {
    ctx.prisma.reservation.findUnique.mockResolvedValue(
      confirmed({ status: 'Modified' }),
    );
    const res = await ctx.service.changeTime('r1', userId, {
      newExpectedTime: inMinutes(90).toISOString(),
    });
    expect(res.message).toContain('một lần');
  });
});

describe('huỷ đặt chỗ', () => {
  const reservation = (status: string, minutesFromNow: number) => ({
    id: 'r1',
    userId,
    status,
    expectedEntryTime: inMinutes(minutesFromNow),
    vehicle: { licensePlate: '51A12345' },
  });

  it('đã cọc, huỷ trước giờ hẹn từ 30 phút: hoàn 100% vào ví', async () => {
    ctx.prisma.reservation.findUnique.mockResolvedValue(
      reservation('Confirmed', 45),
    );
    ctx.prisma.payment.findFirst.mockResolvedValue(paidDeposit);
    const res = await ctx.service.cancel('r1', userId);
    expect(ctx.wallets.creditRefund).toHaveBeenCalledWith(
      ctx.prisma,
      paidDeposit,
      'Deposit',
      expect.stringContaining('51A12345'),
    );
    expect(ctx.prisma.payment.update).toHaveBeenCalledWith({
      where: { id: 'pay-1' },
      data: { paymentStatus: 'Refunded' },
    });
    expect(res.result).toEqual(
      expect.objectContaining({ refundedAmount: 30000 }),
    );
  });

  it('huỷ trong vòng 30 phút trước giờ hẹn: không hoàn cọc', async () => {
    ctx.prisma.reservation.findUnique.mockResolvedValue(
      reservation('Confirmed', 20),
    );
    ctx.prisma.payment.findFirst.mockResolvedValue(paidDeposit);
    const res = await ctx.service.cancel('r1', userId);
    expect(ctx.wallets.creditRefund).not.toHaveBeenCalled();
    expect(res.message).toContain('không được hoàn');
  });

  it('chưa trả cọc: đóng link PayOS đang chờ', async () => {
    ctx.prisma.reservation.findUnique.mockResolvedValue(
      reservation('Pending', 60),
    );
    ctx.prisma.payment.findMany.mockResolvedValue([
      { id: 'pay-0', transactionReference: '1727' },
    ]);
    await ctx.service.cancel('r1', userId);
    expect(ctx.payos.cancelPaymentLink).toHaveBeenCalledWith('1727');
    expect(ctx.wallets.creditRefund).not.toHaveBeenCalled();
  });

  it('đơn đã kết thúc hoặc của người khác thì không huỷ', async () => {
    ctx.prisma.reservation.findUnique.mockResolvedValue(
      reservation('Cancelled', 60),
    );
    ctx.prisma.reservation.updateMany.mockResolvedValue({ count: 0 });
    expect((await ctx.service.cancel('r1', userId)).message).toContain(
      'đã kết thúc',
    );
    ctx.prisma.reservation.findUnique.mockResolvedValue(
      reservation('Confirmed', 60),
    );
    expect((await ctx.service.cancel('r1', otherUser)).statusCode).toBe(403);
  });
});

describe('nhân viên đổi trạng thái', () => {
  const existing = (status: string, minutesFromNow: number) => ({
    id: 'r1',
    userId,
    status,
    expectedEntryTime: inMinutes(minutesFromNow),
    vehicle: { licensePlate: '51A12345' },
  });

  it('không đặt tay sang CheckedIn / Confirmed', async () => {
    ctx.prisma.reservation.findUnique.mockResolvedValue(
      existing('Pending', 60),
    );
    expect(
      (await ctx.service.updateStatus('r1', { status: 'Confirmed' }))
        .statusCode,
    ).toBe(409);
    ctx.prisma.reservation.findUnique.mockResolvedValue(
      existing('Confirmed', 60),
    );
    expect(
      (await ctx.service.updateStatus('r1', { status: 'CheckedIn' }))
        .statusCode,
    ).toBe(409);
    expect(ctx.prisma.reservation.updateMany).not.toHaveBeenCalled();
  });

  it('đánh dấu không đến chỉ sau giờ hẹn', async () => {
    ctx.prisma.reservation.findUnique.mockResolvedValue(
      existing('Confirmed', 10),
    );
    expect(
      (await ctx.service.updateStatus('r1', { status: 'NoShow' })).message,
    ).toContain('sau giờ hẹn');
  });

  it('nhân viên huỷ đơn đã cọc: hoàn 100% cọc và báo khách', async () => {
    ctx.prisma.reservation.findUnique.mockResolvedValue(
      existing('Confirmed', 10),
    );
    ctx.prisma.payment.findFirst.mockResolvedValue(paidDeposit);
    const res = await ctx.service.updateStatus('r1', { status: 'Cancelled' });
    expect(res.statusCode).toBe(200);
    expect(ctx.wallets.creditRefund).toHaveBeenCalled();
    expect(ctx.notifications.notify).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({
        type: 'reservation',
        message: expect.stringContaining('Đã hoàn'),
      }),
    );
  });
});

describe('việc định kỳ', () => {
  it('đơn chờ cọc quá 15 phút: huỷ, đóng link, báo khách', async () => {
    ctx.prisma.reservation.findMany
      .mockResolvedValueOnce([{ id: 'r1' }])
      .mockResolvedValueOnce([]);
    ctx.prisma.reservation.findUnique.mockResolvedValue({
      userId,
      expectedEntryTime: inMinutes(30),
      vehicle: { licensePlate: '51A12345' },
    });
    ctx.prisma.payment.findMany.mockResolvedValue([
      { id: 'pay-0', transactionReference: '1727' },
    ]);
    await ctx.service.processOverdueReservations();
    expect(ctx.prisma.reservation.updateMany).toHaveBeenCalledWith({
      where: { id: 'r1', status: 'Pending' },
      data: { status: 'Cancelled' },
    });
    expect(ctx.payos.cancelPaymentLink).toHaveBeenCalledWith('1727');
    expect(ctx.notifications.notify).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({ title: 'Hết thời gian giữ chỗ' }),
    );
  });

  it('cọc đã về nhưng webhook trễ: xác nhận thay vì huỷ', async () => {
    ctx.prisma.reservation.findMany
      .mockResolvedValueOnce([{ id: 'r1' }])
      .mockResolvedValueOnce([]);
    ctx.prisma.payment.findFirst.mockResolvedValue(paidDeposit);
    await ctx.service.processOverdueReservations();
    expect(ctx.prisma.reservation.updateMany).toHaveBeenCalledWith({
      where: { id: 'r1', status: 'Pending' },
      data: { status: 'Confirmed' },
    });
    expect(ctx.payos.cancelPaymentLink).not.toHaveBeenCalled();
  });
});

describe('danh sách cho nhân viên', () => {
  it('lọc theo ngày giờ Việt Nam và theo bãi', async () => {
    await ctx.service.getAll('Confirmed', '2026-11-02', parkingId);
    const where = ctx.prisma.reservation.findMany.mock.calls[0][0].where;
    expect(where.expectedEntryTime).toEqual({
      gte: new Date('2026-11-01T17:00:00Z'),
      lt: new Date('2026-11-02T17:00:00Z'),
    });
    expect(where.parkingId).toBe(parkingId);
  });
});
