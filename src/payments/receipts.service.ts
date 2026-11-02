import { Injectable, Optional } from '@nestjs/common';
import type { Payment } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'crypto';
import { join } from 'path';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../prisma/prisma.service';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import { isEmptyGuid, pbmsPick, sameStatus, toMoney } from '../common/pbms-fields';
import { NotificationsService, formatVnd } from '../notifications/notifications.service';
import { PAYMENT_TYPE_LABELS } from './payments.service';

const LINK_TTL_MS = 10 * 60 * 1000;
const TAX_CODE_RE = /^\d{10}(-\d{3})?$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FONT_DIR = join(process.cwd(), 'assets', 'fonts');

const vnTime = (d: Date | null | undefined) =>
  d ? d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false }) : '—';
const vnDate = (d: Date | null | undefined) =>
  d ? d.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : '—';

function receiptSecret(): string {
  const secret = process.env.RECEIPT_SECRET || process.env.JWT_ACCESS_SECRET;
  if (!secret) throw new Error('Thiếu RECEIPT_SECRET hoặc JWT_ACCESS_SECRET để ký link biên nhận');
  return secret;
}

export function signReceipt(paymentId: string, exp: number): string {
  return createHmac('sha256', receiptSecret()).update(`${paymentId}.${exp}`).digest('hex');
}

/** Link tải PDF có chữ ký, hết hạn sau 10 phút: app mở bằng trình duyệt nên không gửi được JWT. */
export function verifyReceipt(paymentId: string, exp: string, sig: string, now = Date.now()): boolean {
  const expiry = Number(exp);
  if (!Number.isFinite(expiry) || expiry < now || !/^[0-9a-f]{64}$/.test(sig ?? '')) return false;
  return timingSafeEqual(Buffer.from(signReceipt(paymentId, expiry), 'hex'), Buffer.from(sig, 'hex'));
}

@Injectable()
export class ReceiptsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  /** Chủ thanh toán (hoặc quản lý) lấy link tải biên nhận của một thanh toán đã thành công. */
  async link(paymentId: string, userId: string, role: string): Promise<PbmsResponseDto> {
    const denied = await this.loadOwned(paymentId, userId, role);
    if ('error' in denied) return denied.error;
    const exp = Date.now() + LINK_TTL_MS;
    const base = (process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000').replace(/\/+$/, '');
    return PbmsResponseDto.ok('Tạo link biên nhận thành công', {
      url: `${base}/api/receipts/${paymentId}/pdf?exp=${exp}&sig=${signReceipt(paymentId, exp)}`,
      expiresAt: new Date(exp),
    });
  }

  /** Khách gửi (hoặc sửa khi chưa xuất) thông tin công ty để kế toán xuất hoá đơn GTGT. */
  async requestInvoice(paymentId: string, userId: string, dto: object): Promise<PbmsResponseDto> {
    const owned = await this.loadOwned(paymentId, userId, '');
    if ('error' in owned) return owned.error;
    if (sameStatus(owned.payment.paymentType ?? '', 'WalletTopUp')) {
      return PbmsResponseDto.fail('Nạp ví không xuất hoá đơn; hoá đơn xuất theo từng lần sử dụng dịch vụ');
    }
    const companyName = pbmsPick(dto, 'companyName', 'CompanyName').trim();
    const taxCode = pbmsPick(dto, 'taxCode', 'TaxCode').trim();
    const address = pbmsPick(dto, 'address', 'Address').trim();
    const email = pbmsPick(dto, 'email', 'Email').trim();
    if (!companyName || companyName.length > 200 || !address || address.length > 300) {
      return PbmsResponseDto.fail('Vui lòng nhập tên công ty và địa chỉ');
    }
    if (!TAX_CODE_RE.test(taxCode)) {
      return PbmsResponseDto.fail('Mã số thuế gồm 10 số, hoặc 10 số kèm -3 số chi nhánh');
    }
    if (!EMAIL_RE.test(email) || email.length > 100) {
      return PbmsResponseDto.fail('Email nhận hoá đơn không hợp lệ');
    }
    const existing = await this.prisma.invoiceRequest.findUnique({ where: { paymentId } });
    if (existing && !sameStatus(existing.status, 'Pending')) {
      return PbmsResponseDto.fail('Hoá đơn của thanh toán này đã được xuất', 409);
    }
    const data = { companyName, taxCode, address, email };
    const saved = existing
      ? await this.prisma.invoiceRequest.update({ where: { id: existing.id }, data })
      : await this.prisma.invoiceRequest.create({ data: { ...data, paymentId, userId } });
    return PbmsResponseDto.ok('Đã gửi yêu cầu xuất hoá đơn', saved, existing ? 200 : 201);
  }

  async listInvoiceRequests(status: string | undefined): Promise<PbmsResponseDto> {
    const items = await this.prisma.invoiceRequest.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const payments = await this.prisma.payment.findMany({
      where: { id: { in: items.map((i) => i.paymentId) } },
      select: { id: true, amount: true, paymentType: true, paymentTime: true, transactionReference: true },
    });
    const byId = new Map(payments.map((p) => [p.id, p]));
    return PbmsResponseDto.ok(
      'Lấy yêu cầu xuất hoá đơn thành công',
      items.map((i) => {
        const p = byId.get(i.paymentId);
        return {
          ...i,
          amount: p ? toMoney(p.amount) : null,
          paymentType: p?.paymentType ?? null,
          paymentTypeLabel: PAYMENT_TYPE_LABELS[p?.paymentType ?? ''] ?? null,
          paymentTime: p?.paymentTime ?? null,
          orderCode: p?.transactionReference ?? null,
        };
      }),
    );
  }

  /** Kế toán ghi số hoá đơn đã xuất bên nhà cung cấp hoá đơn điện tử, báo khách. */
  async markIssued(id: string, dto: object): Promise<PbmsResponseDto> {
    const invoiceNo = pbmsPick(dto, 'invoiceNo', 'InvoiceNo').trim();
    if (!invoiceNo || invoiceNo.length > 50) {
      return PbmsResponseDto.fail('Vui lòng nhập số hoá đơn');
    }
    const moved = await this.prisma.invoiceRequest.updateMany({
      where: { id, status: 'Pending' },
      data: { status: 'Issued', invoiceNo, issuedAt: new Date() },
    });
    if (moved.count !== 1) {
      return PbmsResponseDto.fail('Không tìm thấy yêu cầu đang chờ xuất', 404);
    }
    const item = await this.prisma.invoiceRequest.findUnique({ where: { id } });
    if (item) {
      await this.notifications?.notify(item.userId, {
        title: 'Đã xuất hoá đơn GTGT',
        message: `Hoá đơn số ${invoiceNo} cho ${item.companyName} đã được gửi tới ${item.email}.`,
        type: 'payment',
        metadata: { paymentId: item.paymentId, invoiceRequestId: id },
      });
    }
    return PbmsResponseDto.ok('Đã đánh dấu xuất hoá đơn', item);
  }

  /** PDF biên nhận cho link đã ký. null khi link sai, hết hạn, hoặc thanh toán không còn thành công. */
  async renderPdf(paymentId: string, exp: string, sig: string): Promise<Buffer | null> {
    if (isEmptyGuid(paymentId) || !verifyReceipt(paymentId, exp, sig)) return null;
    const p = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        user: { select: { fullName: true, email: true, phoneNumber: true } },
        session: {
          include: { entryGate: { include: { floor: { include: { parking: { select: { name: true } } } } } } },
        },
        subscription: {
          include: {
            vehicle: { select: { licensePlate: true } },
            package: { select: { packageName: true } },
            parking: { select: { name: true } },
          },
        },
        reservation: { include: { vehicle: { select: { licensePlate: true } }, parking: { select: { name: true } } } },
      },
    });
    if (!p || !sameStatus(p.paymentStatus, 'Success')) return null;
    const invoice = await this.prisma.invoiceRequest.findUnique({ where: { paymentId } });

    const rows: [string, string][] = [
      ['Mã biên nhận', p.transactionReference || p.id.slice(0, 8).toUpperCase()],
      ['Thời gian thanh toán', vnTime(p.paymentTime)],
      ['Khách hàng', p.user?.fullName || '—'],
      ['Email / SĐT', [p.user?.email, p.user?.phoneNumber].filter(Boolean).join(' / ') || '—'],
      ['Nội dung', PAYMENT_TYPE_LABELS[p.paymentType ?? ''] ?? 'Thanh toán PBMS'],
    ];
    if (p.session) {
      rows.push(
        ['Biển số', p.session.licensePlateIn],
        ['Bãi đỗ', p.session.entryGate?.floor?.parking?.name ?? '—'],
        ['Giờ vào', vnTime(p.session.entryTime)],
        ['Giờ ra', vnTime(p.session.exitTime)],
      );
    }
    if (p.subscription) {
      rows.push(
        ['Biển số', p.subscription.vehicle.licensePlate],
        ['Gói', p.subscription.package.packageName],
        ['Bãi áp dụng', p.subscription.parking?.name ?? 'Mọi bãi'],
        ['Hiệu lực vé', `${vnDate(p.subscription.startDate)} - ${vnDate(p.subscription.endDate)}`],
      );
    }
    if (p.reservation) {
      rows.push(
        ['Biển số', p.reservation.vehicle.licensePlate],
        ['Bãi đỗ', p.reservation.parking?.name ?? '—'],
        ['Giờ hẹn', vnTime(p.reservation.expectedEntryTime)],
      );
    }
    rows.push(['Phương thức', p.paymentMethod], ['Số tiền', formatVnd(toMoney(p.amount))]);

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A5', margin: 36 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.registerFont('regular', join(FONT_DIR, 'BeVietnamPro-Regular.ttf'));
      doc.registerFont('bold', join(FONT_DIR, 'BeVietnamPro-Bold.ttf'));

      doc.font('bold').fontSize(16).text('PBMS - Bãi giữ xe thông minh', { align: 'center' });
      doc.font('bold').fontSize(13).text('BIÊN NHẬN THANH TOÁN', { align: 'center' });
      doc.font('regular').fontSize(8).fillColor('#666')
        .text('Biên nhận không thay thế hoá đơn GTGT.', { align: 'center' });
      doc.moveDown(1).fillColor('#000');
      for (const [label, value] of rows) {
        const y = doc.y;
        doc.font('regular').fontSize(9).fillColor('#555').text(label, 36, y, { width: 120 });
        doc.font(label === 'Số tiền' ? 'bold' : 'regular').fontSize(label === 'Số tiền' ? 12 : 10).fillColor('#000')
          .text(value, 160, y, { width: doc.page.width - 196 });
        doc.moveDown(0.4);
      }
      if (invoice) {
        doc.moveDown(0.8).font('bold').fontSize(10).text('Thông tin xuất hoá đơn GTGT', 36);
        doc.font('regular').fontSize(9).text(
          [
            invoice.companyName,
            `MST: ${invoice.taxCode}`,
            invoice.address,
            `Email nhận: ${invoice.email}`,
            sameStatus(invoice.status, 'Issued')
              ? `Đã xuất hoá đơn số ${invoice.invoiceNo} ngày ${vnDate(invoice.issuedAt)}`
              : 'Đang chờ xuất hoá đơn',
          ].join('\n'),
        );
      }
      doc.end();
    });
  }

  private async loadOwned(
    paymentId: string,
    userId: string,
    role: string,
  ): Promise<{ error: PbmsResponseDto } | { payment: Payment }> {
    if (isEmptyGuid(paymentId)) {
      return { error: PbmsResponseDto.fail('PaymentId không hợp lệ') };
    }
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    const manager = ['manager', 'admin'].includes(role.trim().toLowerCase());
    if (!payment || (!manager && payment.userId !== userId)) {
      return { error: PbmsResponseDto.fail('Không tìm thấy thanh toán', 404) };
    }
    if (!sameStatus(payment.paymentStatus, 'Success')) {
      return { error: PbmsResponseDto.fail('Chỉ có biên nhận cho thanh toán đã thành công', 409) };
    }
    return { payment };
  }
}
