import { Injectable } from '@nestjs/common';
import { Prisma, PromoCode } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import { pbmsPick, pbmsPickBool, pbmsPickDate, pbmsPickNumber, toMoney } from '../common/pbms-fields';
import { checkPromoCode, normalizePromoCode } from './promo-codes';

const CODE_RE = /^[A-Z0-9]{3,30}$/;

@Injectable()
export class PromoCodesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Mã đang chạy, còn lượt: app hiện ở màn nạp ví. */
  async available(): Promise<PbmsResponseDto> {
    const now = new Date();
    const items = await this.prisma.promoCode.findMany({
      where: { isActive: true, startsAt: { lte: now }, endsAt: { gte: now } },
      orderBy: { minTopUp: 'asc' },
    });
    return PbmsResponseDto.ok(
      'Lấy mã khuyến mãi thành công',
      items.filter((p) => p.maxUses === null || p.usedCount < p.maxUses).map((p) => this.map(p, false)),
    );
  }

  /** Khách xem trước mã có áp dụng cho số tiền định nạp không. */
  async check(userId: string, dto: object): Promise<PbmsResponseDto> {
    const code = pbmsPick(dto, 'code', 'Code');
    const amount = pbmsPickNumber(dto, 'amount', 'Amount') ?? 0;
    if (!code.trim()) {
      return PbmsResponseDto.fail('Vui lòng nhập mã khuyến mãi');
    }
    const checked = await checkPromoCode(this.prisma, userId, code, amount);
    if (checked.error !== undefined) {
      return PbmsResponseDto.fail(checked.error);
    }
    return PbmsResponseDto.ok('Mã khuyến mãi hợp lệ', this.map(checked.promo, false));
  }

  async list(): Promise<PbmsResponseDto> {
    const items = await this.prisma.promoCode.findMany({ orderBy: { createdAt: 'desc' } });
    return PbmsResponseDto.ok('Lấy danh sách mã khuyến mãi thành công', items.map((p) => this.map(p, true)));
  }

  async create(dto: object): Promise<PbmsResponseDto> {
    const code = normalizePromoCode(pbmsPick(dto, 'code', 'Code'));
    if (!CODE_RE.test(code)) {
      return PbmsResponseDto.fail('Mã gồm 3-30 chữ cái không dấu hoặc số');
    }
    const fields = this.readFields(dto, null);
    if (typeof fields === 'string') {
      return PbmsResponseDto.fail(fields);
    }
    try {
      const created = await this.prisma.promoCode.create({ data: { code, ...fields } });
      return PbmsResponseDto.ok('Tạo mã khuyến mãi thành công', this.map(created, true), 201);
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return PbmsResponseDto.fail('Mã khuyến mãi đã tồn tại', 409);
      }
      throw error;
    }
  }

  /** Sửa hoặc tắt mã. Mã không đổi được (khách có thể đã lưu); số tiền đổi chỉ áp dụng cho lượt nạp sau. */
  async update(id: string, dto: object): Promise<PbmsResponseDto> {
    const existing = await this.prisma.promoCode.findUnique({ where: { id } });
    if (!existing) {
      return PbmsResponseDto.fail('Không tìm thấy mã khuyến mãi', 404);
    }
    const fields = this.readFields(dto, existing);
    if (typeof fields === 'string') {
      return PbmsResponseDto.fail(fields);
    }
    const updated = await this.prisma.promoCode.update({ where: { id }, data: fields });
    return PbmsResponseDto.ok('Cập nhật mã khuyến mãi thành công', this.map(updated, true));
  }

  /** Đọc và kiểm tra các trường; [base] là mã đang có khi sửa (trường không gửi giữ nguyên). Trả lỗi dạng chuỗi. */
  private readFields(dto: object, base: PromoCode | null) {
    const minTopUp = pbmsPickNumber(dto, 'minTopUp', 'MinTopUp') ?? (base ? Number(base.minTopUp) : undefined);
    const bonusAmount = pbmsPickNumber(dto, 'bonusAmount', 'BonusAmount') ?? (base ? Number(base.bonusAmount) : undefined);
    const bonusValidDays = pbmsPickNumber(dto, 'bonusValidDays', 'BonusValidDays') ?? base?.bonusValidDays ?? 30;
    // 0 = bỏ giới hạn; không gửi = giữ như cũ.
    const rawMax = pbmsPickNumber(dto, 'maxUses', 'MaxUses');
    const maxUses = rawMax === undefined ? (base ? base.maxUses : null) : rawMax === 0 ? null : rawMax;
    const startsAt = pbmsPickDate(dto, 'startsAt', 'StartsAt') ?? base?.startsAt ?? new Date();
    const endsAt = pbmsPickDate(dto, 'endsAt', 'EndsAt') ?? base?.endsAt;
    const isActive = pbmsPickBool(dto, 'isActive', 'IsActive') ?? base?.isActive ?? true;
    const description = pbmsPick(dto, 'description', 'Description').trim() || base?.description || null;
    if (minTopUp === undefined || !Number.isInteger(minTopUp) || minTopUp < 2000) {
      return 'Mức nạp tối thiểu phải là số nguyên từ 2.000 đ';
    }
    if (bonusAmount === undefined || !Number.isInteger(bonusAmount) || bonusAmount <= 0 || bonusAmount > minTopUp) {
      return 'Tiền tặng phải lớn hơn 0 và không vượt mức nạp tối thiểu';
    }
    if (!Number.isInteger(bonusValidDays) || bonusValidDays < 1 || bonusValidDays > 365) {
      return 'Hạn dùng tiền tặng từ 1 đến 365 ngày';
    }
    if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1)) {
      return 'Số lượt tối đa phải là số nguyên dương hoặc để trống';
    }
    if (!endsAt || endsAt <= startsAt) {
      return 'Ngày kết thúc phải sau ngày bắt đầu';
    }
    return {
      description,
      minTopUp: new Prisma.Decimal(minTopUp),
      bonusAmount: new Prisma.Decimal(bonusAmount),
      bonusValidDays,
      maxUses,
      startsAt,
      endsAt,
      isActive,
    };
  }

  private map(p: PromoCode, forManager: boolean) {
    return {
      promoCodeId: p.id,
      code: p.code,
      description: p.description,
      minTopUp: toMoney(p.minTopUp),
      bonusAmount: toMoney(p.bonusAmount),
      bonusValidDays: p.bonusValidDays,
      endsAt: p.endsAt,
      ...(forManager
        ? { startsAt: p.startsAt, maxUses: p.maxUses, usedCount: p.usedCount, isActive: p.isActive, createdAt: p.createdAt }
        : {}),
    };
  }
}
