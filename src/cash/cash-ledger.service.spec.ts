import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CashLedgerService, cashState, parseCashRange } from './cash-ledger.service';

const money = (n: number) => new Prisma.Decimal(n);
const pay = (id: string, amount: number, extra: object = {}) => ({
  id,
  amount: money(amount),
  paymentMethod: 'Cash',
  paymentStatus: 'Success',
  paymentType: 'CheckoutFee',
  paymentTime: new Date('2026-11-02T03:00:00Z'),
  sessionId: `s-${id}`,
  session: { licensePlateIn: '51A12345', licensePlateOut: null },
  collectedById: 'staff-1',
  collectedGateId: 'gate-1',
  cashHandoverId: null,
  cashHandover: null,
  ...extra,
});

const handoverRow = (extra: object = {}) => ({
  id: 'h-1',
  staffId: 'staff-1',
  amount: money(75000),
  paymentCount: 2,
  status: 'Submitted',
  note: null,
  submittedAt: new Date(),
  reviewedById: 'mgr',
  reviewedAt: new Date(),
  reviewNote: null,
  ...extra,
});

function setup() {
  const prisma = {
    payment: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn() },
    cashHandover: {
      create: jest.fn((a: { data: object }) =>
        Promise.resolve({ id: 'h-1', status: 'Submitted', submittedAt: new Date(), reviewedById: null, reviewedAt: null, reviewNote: null, ...a.data }),
      ),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    user: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'staff-1', fullName: 'Lan', email: 'lan@pbms.vn' },
        { id: 'staff-2', fullName: null, email: 'minh@pbms.vn' },
      ]),
    },
    gate: { findMany: jest.fn().mockResolvedValue([{ id: 'gate-1', gateName: 'Cổng ra A' }]) },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
  return { prisma, service: new CashLedgerService(prisma as unknown as PrismaService) };
}

describe('Kỳ tra cứu sổ quỹ', () => {
  it('mặc định tháng này theo giờ Việt Nam (đầu tháng VN = 17h UTC hôm trước)', () => {
    const r = parseCashRange(undefined, undefined, new Date('2026-11-30T18:00:00Z')); // 01/12 01:00 giờ VN
    expect(r).toEqual({ from: new Date('2026-11-30T17:00:00Z'), to: new Date('2026-12-31T17:00:00Z') });
  });

  it('báo lỗi khi thiếu một đầu, ngược chiều, sai định dạng hoặc quá 400 ngày', () => {
    expect(typeof parseCashRange('2026-11-01T00:00:00+07:00')).toBe('string');
    expect(typeof parseCashRange('2026-11-08', '2026-11-01')).toBe('string');
    expect(typeof parseCashRange('abc', '2026-11-01')).toBe('string');
    expect(typeof parseCashRange('2025-01-01', '2026-11-01')).toBe('string');
    expect(parseCashRange('2026-10-26T00:00:00+07:00', '2026-11-02T00:00:00+07:00')).toEqual({
      from: new Date('2026-10-25T17:00:00Z'),
      to: new Date('2026-11-01T17:00:00Z'),
    });
  });

  it('trạng thái tiền: chưa rõ người thu, đang giữ, đã chốt, đã nhận', () => {
    expect(cashState({ collectedById: null, cashHandover: null })).toBe('Unassigned');
    expect(cashState({ collectedById: 's', cashHandover: null })).toBe('Holding');
    expect(cashState({ collectedById: 's', cashHandover: { status: 'Submitted' } })).toBe('Submitted');
    expect(cashState({ collectedById: 's', cashHandover: { status: 'Confirmed' } })).toBe('Confirmed');
  });
});

describe('Chốt nộp tiền', () => {
  it('gộp mọi khoản đang giữ thành một phiếu, đúng tổng tiền', async () => {
    const { prisma, service } = setup();
    prisma.payment.findMany.mockResolvedValue([pay('p1', 30000), pay('p2', 45000)]);
    prisma.payment.updateMany.mockResolvedValue({ count: 2 });
    const res = await service.submitHandover('staff-1', { reason: 'Chốt ca chiều' });
    expect(res.statusCode).toBe(200);
    expect(prisma.cashHandover.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ staffId: 'staff-1', amount: money(75000), paymentCount: 2, note: 'Chốt ca chiều' }),
    });
    expect(prisma.payment.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['p1', 'p2'] }, cashHandoverId: null },
      data: { cashHandoverId: 'h-1' },
    });
    expect(res.result).toMatchObject({ amount: 75000, paymentCount: 2, staffName: 'Lan', status: 'Submitted' });
  });

  it('không giữ khoản nào thì báo 409, không tạo phiếu', async () => {
    const { prisma, service } = setup();
    expect((await service.submitHandover('staff-1', {})).statusCode).toBe(409);
    expect(prisma.cashHandover.create).not.toHaveBeenCalled();
  });

  it('bấm chốt 2 lần cùng lúc: lần sau gắn thiếu khoản thì huỷ, báo 409', async () => {
    const { prisma, service } = setup();
    prisma.payment.findMany.mockResolvedValue([pay('p1', 30000), pay('p2', 45000)]);
    prisma.payment.updateMany.mockResolvedValue({ count: 1 });
    expect((await service.submitHandover('staff-1', {})).statusCode).toBe(409);
  });
});

describe('Quản lý nhận tiền', () => {
  it('từ chối bắt buộc lý do', async () => {
    const { prisma, service } = setup();
    expect((await service.review('h-1', 'mgr', 'Rejected', {})).statusCode).toBe(400);
    expect(prisma.cashHandover.updateMany).not.toHaveBeenCalled();
  });

  it('từ chối: các khoản trả về nhân viên giữ để chốt lại', async () => {
    const { prisma, service } = setup();
    prisma.cashHandover.updateMany.mockResolvedValue({ count: 1 });
    prisma.cashHandover.findUnique.mockResolvedValue(handoverRow({ status: 'Rejected', reviewNote: 'Thiếu 20.000đ' }));
    const res = await service.review('h-1', 'mgr', 'Rejected', { reason: 'Thiếu 20.000đ' });
    expect(res.statusCode).toBe(200);
    expect(prisma.cashHandover.updateMany).toHaveBeenCalledWith({
      where: { id: 'h-1', status: 'Submitted' },
      data: expect.objectContaining({ status: 'Rejected', reviewedById: 'mgr', reviewNote: 'Thiếu 20.000đ' }),
    });
    expect(prisma.payment.updateMany).toHaveBeenCalledWith({ where: { cashHandoverId: 'h-1' }, data: { cashHandoverId: null } });
  });

  it('xác nhận không đụng tới các khoản; phiếu đã xử lý thì 409, không có phiếu thì 404', async () => {
    const { prisma, service } = setup();
    prisma.cashHandover.updateMany.mockResolvedValue({ count: 1 });
    prisma.cashHandover.findUnique.mockResolvedValue(handoverRow({ status: 'Confirmed' }));
    expect((await service.review('h-1', 'mgr', 'Confirmed', {})).statusCode).toBe(200);
    expect(prisma.payment.updateMany).not.toHaveBeenCalled();

    prisma.cashHandover.updateMany.mockResolvedValue({ count: 0 });
    prisma.cashHandover.findUnique.mockResolvedValue({ status: 'Confirmed' });
    expect((await service.review('h-1', 'mgr', 'Confirmed', {})).statusCode).toBe(409);
    prisma.cashHandover.findUnique.mockResolvedValue(null);
    expect((await service.review('h-x', 'mgr', 'Confirmed', {})).statusCode).toBe(404);
  });

  it('nhân viên không xem được phiếu của người khác', async () => {
    const { prisma, service } = setup();
    prisma.cashHandover.findUnique.mockResolvedValue({ ...handoverRow({ staffId: 'staff-2' }), payments: [] });
    expect((await service.getHandover('h-1', { userId: 'staff-1', isManager: false })).statusCode).toBe(404);
  });

  it('nhân viên chỉ liệt kê phiếu của mình dù gửi staffId người khác', async () => {
    const { prisma, service } = setup();
    await service.listHandovers({ staffId: 'staff-2' }, { userId: 'staff-1', isManager: false });
    expect(prisma.cashHandover.findMany.mock.calls[0][0].where.staffId).toBe('staff-1');
  });
});

describe('Sổ quỹ theo kỳ', () => {
  const period = [
    pay('p1', 30000),
    pay('p2', 45000, { cashHandoverId: 'h-1', cashHandover: { id: 'h-1', status: 'Submitted' } }),
    pay('p3', 20000, { collectedById: 'staff-2', cashHandoverId: 'h-2', cashHandover: { id: 'h-2', status: 'Confirmed' } }),
    pay('p4', 10000, { collectedById: null, collectedGateId: null }),
  ];

  it('tổng theo trạng thái, theo nhân viên, theo cổng; ai đang giữ bao nhiêu', async () => {
    const { prisma, service } = setup();
    prisma.payment.findMany.mockResolvedValueOnce(period).mockResolvedValueOnce([
      { collectedById: 'staff-1', amount: money(30000), paymentTime: new Date('2026-11-02T03:00:00Z'), cashHandover: null },
      { collectedById: 'staff-1', amount: money(45000), paymentTime: new Date('2026-11-01T03:00:00Z'), cashHandover: { status: 'Submitted' } },
    ]);
    const res = await service.ledger({ from: '2026-11-01T00:00:00+07:00', to: '2026-12-01T00:00:00+07:00' });
    const r = res.result as {
      summary: Record<string, number>;
      byStaff: { staffName: string; amount: number }[];
      byGate: { gateName: string; amount: number }[];
      holdingNow: { staffName: string; holding: number; submitted: number; since: Date }[];
      payments: { state: string }[];
    };
    expect(r.summary).toEqual({ total: 105000, count: 4, holding: 30000, submitted: 45000, confirmed: 20000, unassigned: 10000 });
    expect(r.byStaff).toEqual([
      expect.objectContaining({ staffName: 'Lan', amount: 75000, count: 2 }),
      expect.objectContaining({ staffName: 'minh@pbms.vn', amount: 20000 }),
      expect.objectContaining({ staffName: 'Không rõ người thu', amount: 10000 }),
    ]);
    expect(r.byGate[0]).toMatchObject({ gateName: 'Cổng ra A', amount: 95000 });
    expect(r.holdingNow).toEqual([
      expect.objectContaining({ staffName: 'Lan', holding: 30000, submitted: 45000, count: 2, since: new Date('2026-11-01T03:00:00Z') }),
    ]);
    expect(r.payments.map((p) => p.state)).toEqual(['Holding', 'Submitted', 'Confirmed', 'Unassigned']);
    // Chỉ lấy tiền mặt đã thu xong trong kỳ.
    expect(prisma.payment.findMany.mock.calls[0][0].where).toMatchObject({
      paymentMethod: 'Cash',
      paymentStatus: 'Success',
      paymentTime: { gte: new Date('2026-10-31T17:00:00Z'), lt: new Date('2026-11-30T17:00:00Z') },
    });
  });

  it('kỳ sai thì 400, không truy vấn', async () => {
    const { prisma, service } = setup();
    expect((await service.ledger({ from: '2026-11-08', to: '2026-11-01' })).statusCode).toBe(400);
    expect(prisma.payment.findMany).not.toHaveBeenCalled();
  });

  it('CSV: có BOM cho Excel, đúng cột, dòng tổng, thoát dấu phẩy', async () => {
    const { prisma, service } = setup();
    prisma.user.findMany.mockResolvedValue([{ id: 'staff-1', fullName: 'Lan, ca chiều', email: 'x' }]);
    prisma.payment.findMany.mockResolvedValue([pay('p1', 30000), pay('p4', 10000, { collectedById: null, collectedGateId: null })]);
    const csv = (await service.exportCsv({ from: '2026-11-01T00:00:00+07:00', to: '2026-12-01T00:00:00+07:00' })) as string;
    const lines = csv.slice(1).trim().split('\r\n');
    expect(csv.startsWith('﻿')).toBe(true);
    expect(lines[0]).toBe('Thời gian thu,Số tiền (VND),Biển số,Nhân viên thu,Cổng,Trạng thái,Mã phiếu nộp,Mã thanh toán');
    expect(lines[1]).toContain(',30000,51A12345,"Lan, ca chiều",Cổng ra A,Nhân viên đang giữ,,p1');
    expect(lines[2]).toContain(',10000,51A12345,Không rõ người thu,,Không rõ người thu,,p4');
    expect(lines[3]).toBe('Tổng cộng,40000,,,,2 khoản,,');
  });
});
