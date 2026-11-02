import { Prisma } from '@prisma/client';
import { ValidationPipe } from '@nestjs/common';
import { PbmsBodyDto } from '../common/dto/pbms-body.dto';
import { checkPromoCode, grantPromoBonus } from './promo-codes';
import { PromoCodesService } from './promo-codes.service';
import { PrismaService } from '../prisma/prisma.service';

const DAY = 864e5;
const promo = (extra: object = {}) => ({
  id: 'promo-1',
  code: 'NAP500K',
  minTopUp: new Prisma.Decimal(500000),
  bonusAmount: new Prisma.Decimal(50000),
  bonusValidDays: 30,
  maxUses: 100,
  usedCount: 0,
  startsAt: new Date(Date.now() - DAY),
  endsAt: new Date(Date.now() + DAY),
  isActive: true,
  ...extra,
});

function db(p: object | null, used = false) {
  return {
    promoCode: { findUnique: jest.fn().mockResolvedValue(p) },
    promoRedemption: { findUnique: jest.fn().mockResolvedValue(used ? { id: 'r' } : null) },
  };
}

describe('Kiểm tra mã khuyến mãi khi nạp', () => {
  it('khách gõ thường vẫn nhận, nạp đủ mức thì hợp lệ', async () => {
    const d = db(promo());
    const res = await checkPromoCode(d as never, 'u1', ' nap500k ', 500000);
    expect(res.promo?.code).toBe('NAP500K');
    expect(d.promoCode.findUnique).toHaveBeenCalledWith({ where: { code: 'NAP500K' } });
  });

  it.each([
    ['không tồn tại', null, 500000, false, 'không tồn tại'],
    ['đã tắt', promo({ isActive: false }), 500000, false, 'hết hạn'],
    ['chưa tới ngày', promo({ startsAt: new Date(Date.now() + DAY) }), 500000, false, 'hết hạn'],
    ['quá ngày', promo({ endsAt: new Date(Date.now() - 1000) }), 500000, false, 'hết hạn'],
    ['hết lượt', promo({ usedCount: 100 }), 500000, false, 'hết lượt'],
    ['nạp chưa đủ', promo(), 499000, false, 'chỉ áp dụng khi nạp từ'],
    ['đã dùng rồi', promo(), 500000, true, 'đã dùng'],
  ])('%s thì từ chối kèm lý do', async (_name, p, amount, used, reason) => {
    const res = await checkPromoCode(db(p, used) as never, 'u1', 'NAP500K', amount);
    expect(res.error).toContain(reason);
  });
});

describe('Tặng tiền khi tiền nạp về', () => {
  function tx(opts: { reserved?: number; inserted?: number } = {}) {
    return {
      promoCode: { findUnique: jest.fn().mockResolvedValue(promo()), update: jest.fn() },
      $executeRaw: jest.fn().mockResolvedValue(opts.reserved ?? 1),
      promoRedemption: { createMany: jest.fn().mockResolvedValue({ count: opts.inserted ?? 1 }) },
      wallet: { update: jest.fn().mockResolvedValue({ bonusBalance: new Prisma.Decimal(50000) }) },
      walletTransaction: { create: jest.fn() },
    };
  }
  const pay = { id: 'pay-1', userId: 'u1', promoCodeId: 'promo-1' };
  const wallet = (extra: object = {}) => ({
    id: 'w1',
    bonusBalance: new Prisma.Decimal(0),
    bonusExpiresAt: null as Date | null,
    ...extra,
  });

  it('cộng 50k vào ngăn khuyến mãi, hạn 30 ngày, ghi sổ theo thanh toán', async () => {
    const t = tx();
    expect(Number(await grantPromoBonus(t as never, pay, wallet()))).toBe(50000);
    const data = t.wallet.update.mock.calls[0][0].data;
    expect(data.bonusBalance).toEqual({ increment: new Prisma.Decimal(50000) });
    expect(Math.round(((data.bonusExpiresAt as Date).getTime() - Date.now()) / DAY)).toBe(30);
    expect(t.walletTransaction.create.mock.calls[0][0].data).toMatchObject({
      paymentId: 'pay-1',
      bucket: 'BONUS',
      referenceType: 'PromoCode',
    });
  });

  it('mã vừa hết lượt: không tặng, không ghi đã dùng', async () => {
    const t = tx({ reserved: 0 });
    expect(await grantPromoBonus(t as never, pay, wallet())).toBeNull();
    expect(t.promoRedemption.createMany).not.toHaveBeenCalled();
    expect(t.wallet.update).not.toHaveBeenCalled();
  });

  it('hai lần nạp cùng mã về cùng lúc: lần sau không tặng và trả lại lượt', async () => {
    const t = tx({ inserted: 0 });
    expect(await grantPromoBonus(t as never, pay, wallet())).toBeNull();
    expect(t.promoRedemption.createMany.mock.calls[0][0].skipDuplicates).toBe(true);
    expect(t.promoCode.update).toHaveBeenCalledWith({ where: { id: 'promo-1' }, data: { usedCount: { decrement: 1 } } });
    expect(t.wallet.update).not.toHaveBeenCalled();
  });

  it('tiền khuyến mãi cũ đã quá hạn thì bỏ, không hồi sinh', async () => {
    const t = tx();
    await grantPromoBonus(t as never, pay, wallet({
      bonusBalance: new Prisma.Decimal(20000),
      bonusExpiresAt: new Date(Date.now() - DAY),
    }));
    expect(t.wallet.update.mock.calls[0][0].data.bonusBalance).toEqual(new Prisma.Decimal(50000));
  });

  it('không rút ngắn hạn khuyến mãi đang dài hơn', async () => {
    const later = new Date(Date.now() + 90 * DAY);
    const t = tx();
    await grantPromoBonus(t as never, pay, wallet({ bonusBalance: new Prisma.Decimal(1000), bonusExpiresAt: later }));
    expect(t.wallet.update.mock.calls[0][0].data.bonusExpiresAt).toBe(later);
  });
});

describe('Quản lý tạo mã', () => {
  const service = (create = jest.fn()) =>
    new PromoCodesService({ promoCode: { create } } as unknown as PrismaService);
  const base = { code: 'nap500k', minTopUp: 500000, bonusAmount: 50000, endsAt: new Date(Date.now() + DAY).toISOString() };

  it('tạo được, mã tự viết hoa', async () => {
    const create = jest.fn().mockResolvedValue(promo());
    const res = await service(create).create(base);
    expect(res.statusCode).toBe(201);
    expect(create.mock.calls[0][0].data.code).toBe('NAP500K');
  });

  it.each([
    [{ code: 'a b' }, 'Mã gồm'],
    [{ bonusAmount: 600000 }, 'Tiền tặng'],
    [{ minTopUp: 1000 }, 'Mức nạp tối thiểu'],
    [{ endsAt: new Date(Date.now() - DAY).toISOString() }, 'Ngày kết thúc'],
    [{ maxUses: -1 }, 'Số lượt'],
  ])('dữ liệu sai %o thì từ chối', async (patch, msg) => {
    const res = await service().create({ ...base, ...patch });
    expect(res.isSuccess).toBe(false);
    expect(res.message).toContain(msg);
  });
});

describe('Body API nhận các trường mới (whitelist + forbidNonWhitelisted)', () => {
  it('không bị chặn 400 vì trường lạ', async () => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
    const body = {
      autoRenew: true,
      promoCode: 'NAP500K',
      code: 'NAP500K',
      minTopUp: 500000,
      bonusAmount: 50000,
      bonusValidDays: 30,
      maxUses: 10,
      startsAt: '2026-11-01',
      endsAt: '2026-12-01',
      isActive: false,
      companyName: 'ABC',
      taxCode: '0312345678',
      address: 'HCM',
      email: 'a@b.vn',
      invoiceNo: '1',
    };
    await expect(pipe.transform(body, { type: 'body', metatype: PbmsBodyDto })).resolves.toMatchObject(body);
  });
});

describe('Giới hạn lượt gửi dạng số', () => {
  it('maxUses số được lưu, 0 là bỏ giới hạn', async () => {
    const create = jest.fn().mockResolvedValue(promo());
    const svc = new PromoCodesService({ promoCode: { create } } as unknown as PrismaService);
    const base = { code: 'NAP500K', minTopUp: 500000, bonusAmount: 50000, endsAt: new Date(Date.now() + DAY).toISOString() };
    await svc.create({ ...base, maxUses: 1000 });
    await svc.create({ ...base, maxUses: 0 });
    expect(create.mock.calls[0][0].data.maxUses).toBe(1000);
    expect(create.mock.calls[1][0].data.maxUses).toBeNull();
  });
});
