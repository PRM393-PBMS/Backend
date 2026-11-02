import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ReceiptsService, signReceipt, verifyReceipt } from './receipts.service';

process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test-secret';
const PAY_ID = '3f1d2a9b-7c4e-4f60-8a1b-5e2d9c7b6a33';

const payment = (extra: object = {}) => ({
  id: PAY_ID,
  userId: 'user-1',
  amount: new Prisma.Decimal(1500000),
  paymentMethod: 'Wallet',
  paymentType: 'SubscriptionFee',
  paymentStatus: 'Success',
  paymentTime: new Date('2026-11-03T03:00:00Z'),
  transactionReference: '123456',
  user: { fullName: 'Nguyễn Văn Ấn', email: 'an@example.com', phoneNumber: '0912345678' },
  session: null,
  reservation: null,
  subscription: {
    startDate: new Date('2026-11-03T00:00:00Z'),
    endDate: new Date('2026-12-03T00:00:00Z'),
    vehicle: { licensePlate: '51A12345' },
    package: { packageName: 'Gói tháng ô tô' },
    parking: { name: 'Bãi Quận 1' },
  },
  ...extra,
});

function setup(p: object | null, invoice: object | null = null) {
  const prisma = {
    payment: { findUnique: jest.fn().mockResolvedValue(p), findMany: jest.fn().mockResolvedValue([]) },
    invoiceRequest: {
      findUnique: jest.fn().mockResolvedValue(invoice),
      create: jest.fn((a: { data: object }) => Promise.resolve({ id: 'inv-1', ...a.data })),
      update: jest.fn((a: { data: object }) => Promise.resolve({ id: 'inv-1', ...a.data })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const notifications = { notify: jest.fn() };
  const service = new ReceiptsService(prisma as unknown as PrismaService, notifications as never);
  return { service, prisma, notifications };
}

describe('Link biên nhận có chữ ký', () => {
  it('đúng chữ ký, còn hạn thì hợp lệ; sửa id, hết hạn, chữ ký rác thì không', () => {
    const exp = Date.now() + 60_000;
    const sig = signReceipt(PAY_ID, exp);
    expect(verifyReceipt(PAY_ID, String(exp), sig)).toBe(true);
    expect(verifyReceipt('00000000-0000-4000-8000-000000000000', String(exp), sig)).toBe(false);
    expect(verifyReceipt(PAY_ID, String(exp), sig, exp + 1)).toBe(false);
    expect(verifyReceipt(PAY_ID, String(exp), 'abc')).toBe(false);
  });

  it('chỉ chủ thanh toán lấy được link, và chỉ khi đã thành công', async () => {
    expect((await setup(payment()).service.link(PAY_ID, 'user-2', 'customer')).statusCode).toBe(404);
    expect((await setup(payment({ paymentStatus: 'Pending' })).service.link(PAY_ID, 'user-1', '')).statusCode).toBe(409);
    const ok = await setup(payment()).service.link(PAY_ID, 'user-1', 'customer');
    expect((ok.result as { url: string }).url).toMatch(new RegExp(`/api/receipts/${PAY_ID}/pdf\\?exp=\\d+&sig=[0-9a-f]{64}$`));
  });
});

describe('PDF biên nhận', () => {
  const signed = () => {
    const exp = Date.now() + 60_000;
    return [String(exp), signReceipt(PAY_ID, exp)] as const;
  };

  it('tạo được PDF có font tiếng Việt, kèm thông tin xuất hoá đơn', async () => {
    const { service } = setup(payment(), {
      companyName: 'Công ty TNHH Ánh Dương',
      taxCode: '0312345678',
      address: '12 Nguyễn Huệ',
      email: 'ketoan@anhduong.vn',
      status: 'Pending',
    });
    const pdf = await service.renderPdf(PAY_ID, ...signed());
    expect(pdf?.subarray(0, 5).toString()).toBe('%PDF-');
    // Font nhúng (không phải Helvetica mặc định thiếu dấu tiếng Việt).
    expect(pdf?.toString('latin1')).toContain('BeVietnamPro');
  });

  it('link sai hoặc thanh toán không còn thành công thì không trả PDF', async () => {
    expect(await setup(payment()).service.renderPdf(PAY_ID, String(Date.now() + 60_000), 'f'.repeat(64))).toBeNull();
    expect(await setup(payment({ paymentStatus: 'Refunded' })).service.renderPdf(PAY_ID, ...signed())).toBeNull();
  });
});

describe('Yêu cầu xuất hoá đơn GTGT', () => {
  const info = { companyName: 'Công ty ABC', taxCode: '0312345678', address: 'HCM', email: 'kt@abc.vn' };

  it('gửi hợp lệ thì lưu chờ xuất', async () => {
    const { service, prisma } = setup(payment());
    const res = await service.requestInvoice(PAY_ID, 'user-1', info);
    expect(res.statusCode).toBe(201);
    expect(prisma.invoiceRequest.create.mock.calls[0][0].data).toMatchObject({ ...info, paymentId: PAY_ID, userId: 'user-1' });
  });

  it.each([
    [{ taxCode: '123' }, 'Mã số thuế'],
    [{ email: 'abc' }, 'Email'],
    [{ companyName: '' }, 'tên công ty'],
  ])('dữ liệu sai %o thì từ chối', async (patch, msg) => {
    const res = await setup(payment()).service.requestInvoice(PAY_ID, 'user-1', { ...info, ...patch });
    expect(res.message).toContain(msg);
  });

  it('nạp ví không xuất hoá đơn; đã xuất thì không sửa được', async () => {
    const topUp = await setup(payment({ paymentType: 'WalletTopUp' })).service.requestInvoice(PAY_ID, 'user-1', info);
    expect(topUp.isSuccess).toBe(false);
    const issued = await setup(payment(), { id: 'inv-1', status: 'Issued' }).service.requestInvoice(PAY_ID, 'user-1', info);
    expect(issued.statusCode).toBe(409);
  });

  it('kế toán ghi số hoá đơn thì báo khách', async () => {
    const { service, prisma, notifications } = setup(payment(), {
      id: 'inv-1', userId: 'user-1', paymentId: PAY_ID, companyName: 'ABC', email: 'kt@abc.vn',
    });
    const res = await service.markIssued('inv-1', { invoiceNo: '00001234' });
    expect(res.isSuccess).toBe(true);
    expect(prisma.invoiceRequest.updateMany.mock.calls[0][0].where).toEqual({ id: 'inv-1', status: 'Pending' });
    expect(notifications.notify.mock.calls[0][1].message).toContain('00001234');
  });
});
