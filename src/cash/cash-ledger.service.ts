import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import { pbmsPick, toMoney } from '../common/pbms-fields';
import { PrismaService } from '../prisma/prisma.service';

/** Khoản tiền mặt đã thu xong (nhân viên bấm "đã nhận đủ tiền"). */
const CASH_SUCCESS = { paymentMethod: 'Cash', paymentStatus: 'Success' } as const;
const MAX_RANGE_DAYS = 400;
const NOTE_MAX = 500;
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

type HandoverStatus = 'Submitted' | 'Confirmed' | 'Rejected';

/** Trạng thái tiền của một khoản: còn ở nhân viên, đã chốt chờ nhận, quản lý đã nhận, hoặc không rõ người thu. */
export type CashState = 'Holding' | 'Submitted' | 'Confirmed' | 'Unassigned';

export interface CashRange {
  from: Date;
  to: Date;
}

const paymentInclude = {
  session: { select: { licensePlateIn: true, licensePlateOut: true } },
  cashHandover: { select: { id: true, status: true } },
} satisfies Prisma.PaymentInclude;

type CashPayment = Prisma.PaymentGetPayload<{ include: typeof paymentInclude }>;

export function cashState(p: { collectedById: string | null; cashHandover: { status: string } | null }): CashState {
  if (!p.collectedById) return 'Unassigned';
  if (!p.cashHandover) return 'Holding';
  return p.cashHandover.status === 'Confirmed' ? 'Confirmed' : 'Submitted';
}

/**
 * Khoảng thời gian tra cứu: mặc định tháng này theo giờ Việt Nam. `to` không tính (nửa mở).
 * Trả chuỗi lỗi khi khoảng sai hoặc quá dài.
 */
export function parseCashRange(from?: string, to?: string, now = new Date()): CashRange | string {
  if (!from && !to) {
    const vn = new Date(now.getTime() + VN_OFFSET_MS);
    const start = Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), 1) - VN_OFFSET_MS;
    const end = Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth() + 1, 1) - VN_OFFSET_MS;
    return { from: new Date(start), to: new Date(end) };
  }
  const f = from ? new Date(from) : null;
  const t = to ? new Date(to) : null;
  if (!f || !t || Number.isNaN(f.getTime()) || Number.isNaN(t.getTime())) {
    return 'Cần cả from và to dạng ngày giờ ISO, ví dụ 2026-11-01T00:00:00+07:00.';
  }
  if (f >= t) return 'Thời điểm bắt đầu phải trước thời điểm kết thúc.';
  if (t.getTime() - f.getTime() > MAX_RANGE_DAYS * 86_400_000) {
    return `Chỉ tra cứu tối đa ${MAX_RANGE_DAYS} ngày một lần.`;
  }
  return { from: f, to: t };
}

const csvCell = (v: string | number | null | undefined) => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const vnTime = (d: Date | null | undefined) =>
  d ? d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false }) : '';

const STATE_LABELS: Record<CashState, string> = {
  Holding: 'Nhân viên đang giữ',
  Submitted: 'Đã chốt, chờ quản lý nhận',
  Confirmed: 'Quản lý đã nhận',
  Unassigned: 'Không rõ người thu',
};

@Injectable()
export class CashLedgerService {
  constructor(private readonly prisma: PrismaService) {}

  /** Nhân viên: các khoản đang giữ (chưa chốt) và phiếu đã chốt còn chờ quản lý nhận. */
  async myHolding(staffId: string): Promise<PbmsResponseDto> {
    const [held, pending] = await Promise.all([
      this.prisma.payment.findMany({
        where: { ...CASH_SUCCESS, collectedById: staffId, cashHandoverId: null },
        include: paymentInclude,
        orderBy: { paymentTime: 'asc' },
      }),
      this.prisma.cashHandover.findMany({
        where: { staffId, status: 'Submitted' },
        orderBy: { submittedAt: 'desc' },
      }),
    ]);
    const names = await this.names([], held.map((p) => p.collectedGateId));
    return PbmsResponseDto.ok('Lấy tiền mặt đang giữ thành công', {
      amount: held.reduce((sum, p) => sum + toMoney(p.amount), 0),
      count: held.length,
      since: held[0]?.paymentTime ?? null,
      payments: held.map((p) => this.mapPayment(p, names)),
      pendingAmount: pending.reduce((sum, h) => sum + toMoney(h.amount), 0),
      pendingHandovers: pending.map((h) => this.mapHandover(h, names)),
    });
  }

  /** Nhân viên chốt toàn bộ khoản đang giữ thành một phiếu nộp tiền. */
  async submitHandover(staffId: string, dto: object): Promise<PbmsResponseDto> {
    const note = pbmsPick(dto, 'reason', 'Reason', 'note', 'Note').trim();
    if (note.length > NOTE_MAX) return PbmsResponseDto.fail(`Ghi chú tối đa ${NOTE_MAX} ký tự.`);
    try {
      const handover = await this.prisma.$transaction(async (tx) => {
        const held = await tx.payment.findMany({
          where: { ...CASH_SUCCESS, collectedById: staffId, cashHandoverId: null },
          select: { id: true, amount: true },
        });
        if (held.length === 0) return null;
        const created = await tx.cashHandover.create({
          data: {
            staffId,
            amount: held.reduce((sum, p) => sum.add(p.amount), new Prisma.Decimal(0)),
            paymentCount: held.length,
            note: note || null,
          },
        });
        // Chỉ gắn khoản còn tự do: lần chốt song song (bấm 2 lần) làm số khoản lệch thì huỷ cả giao dịch.
        const moved = await tx.payment.updateMany({
          where: { id: { in: held.map((p) => p.id) }, cashHandoverId: null },
          data: { cashHandoverId: created.id },
        });
        if (moved.count !== held.length) throw new Error('HANDOVER_RACE');
        return created;
      });
      if (!handover) return PbmsResponseDto.fail('Bạn không giữ khoản tiền mặt nào cần nộp.', 409);
      const names = await this.names([staffId], []);
      return PbmsResponseDto.ok('Đã chốt nộp tiền, chờ quản lý xác nhận', this.mapHandover(handover, names));
    } catch (error: unknown) {
      if (error instanceof Error && error.message === 'HANDOVER_RACE') {
        return PbmsResponseDto.fail('Các khoản vừa được chốt ở lần khác. Tải lại rồi thử lại.', 409);
      }
      throw error;
    }
  }

  /** Phiếu nộp tiền trong khoảng thời gian; nhân viên chỉ thấy phiếu của mình. */
  async listHandovers(
    query: { from?: string; to?: string; status?: string; staffId?: string },
    viewer: { userId: string; isManager: boolean },
  ): Promise<PbmsResponseDto> {
    const range = parseCashRange(query.from, query.to);
    if (typeof range === 'string') return PbmsResponseDto.fail(range);
    const status = this.normalizeStatus(query.status);
    const handovers = await this.prisma.cashHandover.findMany({
      where: {
        submittedAt: { gte: range.from, lt: range.to },
        ...(status ? { status } : {}),
        staffId: viewer.isManager ? query.staffId || undefined : viewer.userId,
      },
      orderBy: { submittedAt: 'desc' },
    });
    const names = await this.names(handovers.flatMap((h) => [h.staffId, h.reviewedById]), []);
    return PbmsResponseDto.ok('Lấy phiếu nộp tiền thành công', handovers.map((h) => this.mapHandover(h, names)));
  }

  /** Chi tiết phiếu kèm các khoản trong phiếu; nhân viên chỉ xem được phiếu của mình. */
  async getHandover(id: string, viewer: { userId: string; isManager: boolean }): Promise<PbmsResponseDto> {
    const handover = await this.prisma.cashHandover.findUnique({
      where: { id },
      include: { payments: { include: paymentInclude, orderBy: { paymentTime: 'asc' } } },
    });
    if (!handover || (!viewer.isManager && handover.staffId !== viewer.userId)) {
      return PbmsResponseDto.fail('Không tìm thấy phiếu nộp tiền', 404);
    }
    const names = await this.names(
      [handover.staffId, handover.reviewedById],
      handover.payments.map((p) => p.collectedGateId),
    );
    return PbmsResponseDto.ok('Lấy phiếu nộp tiền thành công', {
      ...this.mapHandover(handover, names),
      payments: handover.payments.map((p) => this.mapPayment(p, names)),
    });
  }

  /**
   * Quản lý nhận đủ tiền thì xác nhận; lệch tiền thì từ chối kèm lý do, các khoản trả về nhân viên giữ để chốt lại.
   */
  async review(id: string, managerId: string, decision: 'Confirmed' | 'Rejected', dto: object): Promise<PbmsResponseDto> {
    const note = pbmsPick(dto, 'reason', 'Reason', 'note', 'Note').trim();
    if (note.length > NOTE_MAX) return PbmsResponseDto.fail(`Ghi chú tối đa ${NOTE_MAX} ký tự.`);
    if (decision === 'Rejected' && !note) return PbmsResponseDto.fail('Ghi lý do từ chối (ví dụ thiếu bao nhiêu tiền).');
    const reviewed = await this.prisma.$transaction(async (tx) => {
      // Chỉ phiếu còn chờ: hai quản lý bấm cùng lúc thì người sau nhận count 0.
      const changed = await tx.cashHandover.updateMany({
        where: { id, status: 'Submitted' },
        data: { status: decision, reviewedById: managerId, reviewedAt: new Date(), reviewNote: note || null },
      });
      if (changed.count === 0) return null;
      if (decision === 'Rejected') {
        await tx.payment.updateMany({ where: { cashHandoverId: id }, data: { cashHandoverId: null } });
      }
      return tx.cashHandover.findUnique({ where: { id } });
    });
    if (!reviewed) {
      const exists = await this.prisma.cashHandover.findUnique({ where: { id }, select: { status: true } });
      return exists
        ? PbmsResponseDto.fail('Phiếu này đã được xử lý trước đó.', 409)
        : PbmsResponseDto.fail('Không tìm thấy phiếu nộp tiền', 404);
    }
    const names = await this.names([reviewed.staffId, reviewed.reviewedById], []);
    return PbmsResponseDto.ok(
      decision === 'Confirmed' ? 'Đã xác nhận nhận tiền' : 'Đã từ chối, các khoản trả về nhân viên giữ',
      this.mapHandover(reviewed, names),
    );
  }

  /**
   * Sổ quỹ: mọi khoản tiền mặt đã thu trong kỳ, tổng theo trạng thái, theo nhân viên, theo cổng;
   * kèm số tiền từng nhân viên đang giữ tại thời điểm xem (không phụ thuộc kỳ).
   */
  async ledger(query: { from?: string; to?: string; staffId?: string; gateId?: string }): Promise<PbmsResponseDto> {
    const range = parseCashRange(query.from, query.to);
    if (typeof range === 'string') return PbmsResponseDto.fail(range);
    const [payments, holding] = await Promise.all([
      this.periodPayments(range, query),
      this.prisma.payment.findMany({
        where: {
          ...CASH_SUCCESS,
          collectedById: { not: null },
          OR: [{ cashHandoverId: null }, { cashHandover: { status: 'Submitted' } }],
        },
        select: { collectedById: true, amount: true, paymentTime: true, cashHandover: { select: { status: true } } },
      }),
    ]);
    const names = await this.names(
      [...payments.map((p) => p.collectedById), ...holding.map((p) => p.collectedById)],
      payments.map((p) => p.collectedGateId),
    );

    const summary = { total: 0, count: 0, Holding: 0, Submitted: 0, Confirmed: 0, Unassigned: 0 };
    const byStaff = new Map<string, { staffId: string | null; staffName: string; amount: number; count: number }>();
    const byGate = new Map<string, { gateId: string | null; gateName: string; amount: number; count: number }>();
    for (const p of payments) {
      const amount = toMoney(p.amount);
      summary.total += amount;
      summary.count += 1;
      summary[cashState(p)] += amount;
      const sKey = p.collectedById ?? '';
      const s = byStaff.get(sKey) ?? {
        staffId: p.collectedById,
        staffName: p.collectedById ? names.get(p.collectedById) ?? 'Nhân viên đã xoá' : 'Không rõ người thu',
        amount: 0,
        count: 0,
      };
      s.amount += amount;
      s.count += 1;
      byStaff.set(sKey, s);
      const gKey = p.collectedGateId ?? '';
      const g = byGate.get(gKey) ?? {
        gateId: p.collectedGateId,
        gateName: p.collectedGateId ? names.get(p.collectedGateId) ?? 'Cổng đã xoá' : 'Không rõ cổng',
        amount: 0,
        count: 0,
      };
      g.amount += amount;
      g.count += 1;
      byGate.set(gKey, g);
    }

    const holdingByStaff = new Map<string, { staffId: string; staffName: string; holding: number; submitted: number; count: number; since: Date }>();
    for (const p of holding) {
      const id = p.collectedById!;
      const row = holdingByStaff.get(id) ?? {
        staffId: id,
        staffName: names.get(id) ?? 'Nhân viên đã xoá',
        holding: 0,
        submitted: 0,
        count: 0,
        since: p.paymentTime,
      };
      if (p.cashHandover) row.submitted += toMoney(p.amount);
      else row.holding += toMoney(p.amount);
      row.count += 1;
      if (p.paymentTime < row.since) row.since = p.paymentTime;
      holdingByStaff.set(id, row);
    }

    const desc = <T extends { amount: number }>(m: Map<string, T>) => [...m.values()].sort((a, b) => b.amount - a.amount);
    return PbmsResponseDto.ok('Lấy sổ quỹ tiền mặt thành công', {
      from: range.from,
      to: range.to,
      summary: {
        total: summary.total,
        count: summary.count,
        holding: summary.Holding,
        submitted: summary.Submitted,
        confirmed: summary.Confirmed,
        unassigned: summary.Unassigned,
      },
      byStaff: desc(byStaff),
      byGate: desc(byGate),
      holdingNow: [...holdingByStaff.values()].sort((a, b) => b.holding + b.submitted - (a.holding + a.submitted)),
      payments: payments.map((p) => this.mapPayment(p, names)),
    });
  }

  /** CSV sổ quỹ (mở bằng Excel): BOM để Excel đọc đúng tiếng Việt. */
  async exportCsv(query: { from?: string; to?: string; staffId?: string; gateId?: string }): Promise<string | PbmsResponseDto> {
    const range = parseCashRange(query.from, query.to);
    if (typeof range === 'string') return PbmsResponseDto.fail(range);
    const payments = await this.periodPayments(range, query);
    const names = await this.names(payments.map((p) => p.collectedById), payments.map((p) => p.collectedGateId));
    const header = ['Thời gian thu', 'Số tiền (VND)', 'Biển số', 'Nhân viên thu', 'Cổng', 'Trạng thái', 'Mã phiếu nộp', 'Mã thanh toán'];
    const lines = payments.map((p) => {
      const row = this.mapPayment(p, names);
      return [
        vnTime(p.paymentTime),
        row.amount,
        row.licensePlate,
        row.staffName,
        row.gateName,
        STATE_LABELS[row.state],
        p.cashHandoverId,
        p.id,
      ];
    });
    const total = payments.reduce((sum, p) => sum + toMoney(p.amount), 0);
    lines.push(['Tổng cộng', total, '', '', '', `${payments.length} khoản`, '', '']);
    return '﻿' + [header, ...lines].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }

  private periodPayments(range: CashRange, query: { staffId?: string; gateId?: string }): Promise<CashPayment[]> {
    return this.prisma.payment.findMany({
      where: {
        ...CASH_SUCCESS,
        paymentTime: { gte: range.from, lt: range.to },
        ...(query.staffId ? { collectedById: query.staffId } : {}),
        ...(query.gateId ? { collectedGateId: query.gateId } : {}),
      },
      include: paymentInclude,
      orderBy: { paymentTime: 'desc' },
    });
  }

  /** Tên nhân viên và tên cổng theo id (một lần truy vấn mỗi loại). */
  private async names(userIds: (string | null)[], gateIds: (string | null)[]): Promise<Map<string, string>> {
    const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => Boolean(x)))];
    const [users, gates] = await Promise.all([
      uniq(userIds).length
        ? this.prisma.user.findMany({ where: { id: { in: uniq(userIds) } }, select: { id: true, fullName: true, email: true } })
        : [],
      uniq(gateIds).length
        ? this.prisma.gate.findMany({ where: { id: { in: uniq(gateIds) } }, select: { id: true, gateName: true } })
        : [],
    ]);
    return new Map<string, string>([
      ...users.map((u) => [u.id, u.fullName || u.email] as [string, string]),
      ...gates.map((g) => [g.id, g.gateName] as [string, string]),
    ]);
  }

  private normalizeStatus(value?: string): HandoverStatus | null {
    const v = value?.trim().toLowerCase();
    if (v === 'submitted') return 'Submitted';
    if (v === 'confirmed') return 'Confirmed';
    if (v === 'rejected') return 'Rejected';
    return null;
  }

  private mapPayment(p: CashPayment, names: Map<string, string>) {
    return {
      paymentId: p.id,
      amount: toMoney(p.amount),
      paymentTime: p.paymentTime,
      paymentType: p.paymentType,
      sessionId: p.sessionId,
      licensePlate: p.session?.licensePlateOut || p.session?.licensePlateIn || null,
      staffId: p.collectedById,
      staffName: p.collectedById ? names.get(p.collectedById) ?? 'Nhân viên đã xoá' : 'Không rõ người thu',
      gateId: p.collectedGateId,
      gateName: p.collectedGateId ? names.get(p.collectedGateId) ?? 'Cổng đã xoá' : null,
      handoverId: p.cashHandoverId,
      state: cashState(p),
    };
  }

  private mapHandover(
    h: { id: string; staffId: string; amount: Prisma.Decimal; paymentCount: number; status: string; note: string | null; submittedAt: Date; reviewedById: string | null; reviewedAt: Date | null; reviewNote: string | null },
    names: Map<string, string>,
  ) {
    return {
      handoverId: h.id,
      staffId: h.staffId,
      staffName: names.get(h.staffId) ?? null,
      amount: toMoney(h.amount),
      paymentCount: h.paymentCount,
      status: h.status,
      note: h.note,
      submittedAt: h.submittedAt,
      reviewedById: h.reviewedById,
      reviewedByName: h.reviewedById ? names.get(h.reviewedById) ?? null : null,
      reviewedAt: h.reviewedAt,
      reviewNote: h.reviewNote,
    };
  }
}
