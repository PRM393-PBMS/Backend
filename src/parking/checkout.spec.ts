import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PayosService } from '../integrations/payos-files.service';
import { PlateRecognizerService } from '../integrations/plate-recognizer.service';
import { PaymentsService } from '../payments/payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { WalletsService } from '../wallets/wallets.service';
import { exitPassPayload } from '../common/exit-pass';
import { ParkingOperationsService } from './parking-operations.service';
import { ParkingSessionsService } from './parking-sessions.service';

const gateId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const hoursAgo = (h: number) => new Date(Date.now() - h * 36e5);

describe('Checkout ở cổng ra', () => {
  let ops: ParkingOperationsService;
  let session: Record<string, unknown>;
  let prisma: {
    gate: { findUnique: jest.Mock };
    parkingSession: { findUnique: jest.Mock; findFirst: jest.Mock; findMany: jest.Mock; update: jest.Mock };
    monthlySubscription: { findFirst: jest.Mock };
    pricingPolicy: { findFirst: jest.Mock };
    payment: {
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      aggregate: jest.Mock;
    };
    parkingSlot: { update: jest.Mock };
    reservation: { update: jest.Mock };
  };
  let payos: { createPaymentLink: jest.Mock; cancelPaymentLink: jest.Mock };

  const checkout = (extra: Record<string, unknown> = {}) =>
    ops.checkOut({ gateId, sessionId, licensePlateOut: '51H12345', ...extra });

  beforeEach(async () => {
    session = {
      id: sessionId,
      status: 'Active',
      licensePlateIn: '51H12345',
      vehicleTypeId: 'car',
      entryTime: hoursAgo(3.5),
      entryGateId: 'g-in',
      reservationId: null,
      prepaidAt: null,
      exitPassCode: null,
      actualSlotId: 'slot-1',
      exitTime: null,
      vehicle: { userId: 'u1' },
      vehicleType: { typeName: 'Ô tô' },
    };
    prisma = {
      gate: {
        findUnique: jest.fn().mockResolvedValue({ id: gateId, gateType: 'Exit', floor: { parkingId: 'p1' } }),
      },
      parkingSession: {
        findUnique: jest.fn(() => Promise.resolve(session)),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          session = { ...session, ...data };
          return Promise.resolve(session);
        }),
      },
      monthlySubscription: { findFirst: jest.fn().mockResolvedValue(null) },
      // 2 giờ đầu 20.000đ, mỗi giờ sau 10.000đ.
      pricingPolicy: {
        findFirst: jest.fn().mockResolvedValue({
          basePrice: new Prisma.Decimal(20000),
          baseHours: 2,
          extraHourPrice: new Prisma.Decimal(10000),
          nightSurcharge: new Prisma.Decimal(0),
        }),
      },
      payment: {
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'pay-new', ...data })),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: new Prisma.Decimal(0) } }),
      },
      parkingSlot: { update: jest.fn().mockResolvedValue({}) },
      reservation: { update: jest.fn().mockResolvedValue({}) },
    };
    payos = {
      createPaymentLink: jest
        .fn()
        .mockResolvedValue({ paymentUrl: 'https://pay.os/c', paymentLinkId: 'pl', orderCode: '999', qrCode: 'vietqr' }),
      cancelPaymentLink: jest.fn().mockResolvedValue(undefined),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ParkingOperationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: PayosService, useValue: payos },
        { provide: PlateRecognizerService, useValue: {} },
        {
          provide: ParkingSessionsService,
          useValue: { map: jest.fn((s: { id: string; status: string }) => Promise.resolve({ sessionId: s.id, status: s.status })) },
        },
        { provide: PaymentsService, useValue: {} },
        { provide: WalletsService, useValue: {} },
      ],
    }).compile();
    ops = module.get(ParkingOperationsService);
  });

  it('khách vãng lai trả tiền mặt: tính phí theo giờ, tạo khoản chờ xác nhận, chưa đóng phiên', async () => {
    const res = await checkout();
    expect(res.statusCode).toBe(200);
    expect(res.message).toContain('tiền mặt');
    // 3,5 giờ → làm tròn 4 giờ: 20.000 + 2 × 10.000.
    expect((res.result as { Fee: { amount: number } }).Fee.amount).toBe(40000);
    expect(prisma.payment.create.mock.calls[0][0].data).toMatchObject({
      sessionId,
      paymentType: 'CheckoutFee',
      paymentMethod: 'Cash',
      paymentStatus: 'Pending',
    });
    expect(session.status).toBe('Active');
    expect(session.exitGateId).toBe(gateId);
  });

  it('nhân viên xác nhận tiền mặt: thanh toán thành công, đóng phiên, trả ô', async () => {
    await checkout();
    prisma.payment.findUnique.mockResolvedValue({
      id: 'pay-new',
      sessionId,
      reservationId: null,
      amount: new Prisma.Decimal(40000),
      paymentMethod: 'Cash',
      paymentType: 'CheckoutFee',
      paymentTime: new Date(),
      paymentStatus: 'Pending',
      transactionReference: '',
    });
    const res = await ops.confirmCash('pay-new', 'staff-1');
    expect(res.statusCode).toBe(200);
    // Sổ quỹ: ghi nhân viên nhận tiền và cổng thu, nhân viên giữ tiền đến khi chốt nộp.
    expect(prisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pay-new' },
        data: expect.objectContaining({ paymentStatus: 'Success', collectedById: 'staff-1', collectedGateId: session.exitGateId }),
      }),
    );
    expect(session.status).toBe('Completed');
    expect(prisma.parkingSlot.update).toHaveBeenCalledWith({ where: { id: 'slot-1' }, data: { status: 'Available' } });
  });

  it('trả PayOS: tạo link và chuỗi VietQR cho màn hình cổng', async () => {
    const res = await checkout({ paymentMethod: 'PayOS' });
    const result = res.result as { OnlinePayment: { paymentUrl: string; qrCode: string } };
    expect(result.OnlinePayment).toMatchObject({ paymentUrl: 'https://pay.os/c', qrCode: 'vietqr' });
    expect(prisma.payment.update).toHaveBeenCalledWith({ where: { id: 'pay-new' }, data: { transactionReference: '999' } });
  });

  it('PayOS lỗi: báo 502, không đóng phiên', async () => {
    payos.createPaymentLink.mockRejectedValue(new Error('timeout'));
    const res = await checkout({ paymentMethod: 'PayOS' });
    expect(res.statusCode).toBe(502);
    expect(session.status).toBe('Active');
  });

  it('bấm checkout lại: đóng khoản chờ cũ (huỷ link PayOS cũ) rồi mới tạo khoản mới', async () => {
    prisma.payment.findMany.mockResolvedValue([
      { id: 'pay-old', paymentMethod: 'PayOS', transactionReference: '777', paymentStatus: 'Pending' },
    ]);
    const res = await checkout({ paymentMethod: 'Cash' });
    expect(res.statusCode).toBe(200);
    expect(payos.cancelPaymentLink).toHaveBeenCalledWith('777');
    expect(prisma.payment.updateMany).toHaveBeenCalledWith({
      where: { id: 'pay-old', paymentStatus: 'Pending' },
      data: { paymentStatus: 'Failed' },
    });
    expect(prisma.payment.create).toHaveBeenCalledTimes(1);
  });

  it('link PayOS cũ không huỷ được (khách có thể đang trả): dừng, không tạo khoản thứ hai', async () => {
    prisma.payment.findMany.mockResolvedValue([
      { id: 'pay-old', paymentMethod: 'PayOS', transactionReference: '777', paymentStatus: 'Pending' },
    ]);
    payos.cancelPaymentLink.mockRejectedValue(new Error('paid'));
    const res = await checkout({ paymentMethod: 'Cash' });
    expect(res.statusCode).toBe(409);
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it('biển số xe ra khác xe vào: từ chối, không ghi giờ ra', async () => {
    const res = await checkout({ licensePlateOut: '30A99999' });
    expect(res.statusCode).toBe(409);
    expect(res.message).toContain('không khớp');
    expect(prisma.parkingSession.update).not.toHaveBeenCalled();
  });

  it('khách vé tháng: ra miễn phí, đóng phiên ngay, giữ ô cố định', async () => {
    prisma.monthlySubscription.findFirst.mockResolvedValue({ id: 'sub', fixedSlotId: 'slot-1' });
    const res = await checkout();
    expect(res.message).toContain('gói tháng');
    expect(prisma.payment.create).not.toHaveBeenCalled();
    expect(session.status).toBe('Completed');
    expect(prisma.parkingSlot.update).toHaveBeenCalledWith({ where: { id: 'slot-1' }, data: { status: 'Assigned' } });
  });

  it('khách đã trả trước trên app (quét mã ra cổng): ra luôn, không thu thêm', async () => {
    session.prepaidAt = hoursAgo(0.1);
    session.exitPassCode = 'AB23CD';
    const res = await ops.checkOut({ gateId, qrPayload: exitPassPayload(sessionId, 'AB23CD'), licensePlateOut: '51H12345' });
    expect(res.message).toContain('thanh toán trước');
    expect(prisma.payment.create).not.toHaveBeenCalled();
    expect(session.status).toBe('Completed');
  });

  it('mã ra cổng sai: từ chối', async () => {
    session.prepaidAt = hoursAgo(0.1);
    session.exitPassCode = 'AB23CD';
    const res = await ops.checkOut({ gateId, qrPayload: exitPassPayload(sessionId, 'ZZZZZZ') });
    expect(res.statusCode).toBe(403);
  });

  it('nhập tay mã ra cổng 6 ký tự: tìm đúng phiên đã trả trước', async () => {
    session.prepaidAt = hoursAgo(0.1);
    session.exitPassCode = 'AB23CD';
    prisma.parkingSession.findMany.mockResolvedValue([{ id: sessionId }]);
    const res = await ops.checkOut({ gateId, qrPayload: 'ab23cd' });
    expect(res.statusCode).toBe(200);
    expect(prisma.parkingSession.findMany.mock.calls[0][0].where).toEqual({ exitPassCode: 'AB23CD', status: 'Active' });
  });

  it('khách mất vé: tìm phiên theo biển số', async () => {
    prisma.parkingSession.findFirst.mockResolvedValue({ id: sessionId });
    const res = await ops.checkOut({ gateId, licensePlate: '51H-123.45', licensePlateOut: '51H12345' });
    expect(res.statusCode).toBe(200);
    expect(prisma.parkingSession.findFirst.mock.calls[0][0].where).toMatchObject({ licensePlateIn: '51H12345', status: 'Active' });
  });

  it('xe đặt chỗ trước: trừ tiền cọc vào phí; cọc đủ thì ra luôn và hoàn tất đặt chỗ', async () => {
    session.reservationId = 'r1';
    session.entryTime = hoursAgo(1);
    prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: new Prisma.Decimal(30000) } });
    const res = await checkout();
    const fee = (res.result as { Fee: { grossAmount: number; depositAmount: number; amount: number } }).Fee;
    expect(fee).toMatchObject({ grossAmount: 20000, depositAmount: 20000, amount: 0 });
    expect(prisma.payment.create).not.toHaveBeenCalled();
    expect(prisma.reservation.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { status: 'Completed' } });
  });

  it('cổng vào không dùng để checkout; phiên đã ra thì báo không tìm thấy', async () => {
    prisma.gate.findUnique.mockResolvedValue({ id: gateId, gateType: 'Entry', floor: { parkingId: 'p1' } });
    expect((await checkout()).message).toContain('Exit');
    prisma.gate.findUnique.mockResolvedValue({ id: gateId, gateType: 'Exit', floor: { parkingId: 'p1' } });
    session.status = 'Completed';
    expect((await checkout()).statusCode).toBe(404);
  });
});
