import { Injectable, StreamableFile } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../prisma/prisma.service';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import { sameStatus, toMoney } from '../common/pbms-fields';

type Range = { from: Date; to: Date; groupBy: string; vehicleTypeId?: string | null };

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  getTypes(): PbmsResponseDto {
    return PbmsResponseDto.ok('Lấy danh sách loại báo cáo thành công', [
      {
        key: 'full',
        name: 'Báo cáo thống kê đầy đủ',
        description: 'Gộp tổng quan, doanh thu và vận hành bãi xe trong cùng một file PDF.',
        supportedFormats: ['pdf'],
      },
    ]);
  }

  async summary(query: Record<string, string | undefined>): Promise<PbmsResponseDto> {
    const range = this.normalizeRange(query);
    const payments = await this.successfulPayments(range);
    const totalRevenue = payments.reduce((sum, p) => sum + toMoney(p.amount), 0);
    const slots = await this.slotOverview();
    const sessions = await this.prisma.parkingSession.findMany({
      where: { entryTime: { gte: range.from, lte: range.to } },
    });
    const exits = await this.prisma.parkingSession.findMany({
      where: { exitTime: { gte: range.from, lte: range.to } },
    });
    return PbmsResponseDto.ok('Lấy báo cáo tổng quan thành công', {
      range,
      metrics: [
        this.metric('totalRevenue', 'Tổng doanh thu', totalRevenue, 'VND'),
        this.metric('successfulPayments', 'Số thanh toán thành công', payments.length, 'lần'),
        this.metric('entries', 'Lượt xe vào', sessions.length, 'lượt'),
        this.metric('exits', 'Lượt xe ra', exits.length, 'lượt'),
        this.metric('slotUtilizationRate', 'Tỷ lệ sử dụng chỗ đỗ', slots.utilizationRate, '%'),
      ],
      revenueSeries: this.series(payments, range),
      revenueByPaymentType: this.breakdown(payments, (p) => p.paymentType ?? 'Unknown'),
      revenueByPaymentMethod: this.breakdown(payments, (p) => p.paymentMethod),
      slots,
      slotOccupancyByFloor: await this.floorOccupancy(),
    });
  }

  async revenue(query: Record<string, string | undefined>): Promise<PbmsResponseDto> {
    const range = this.normalizeRange(query);
    const payments = await this.successfulPayments(range);
    const totalRevenue = payments.reduce((sum, p) => sum + toMoney(p.amount), 0);
    const avg = payments.length ? totalRevenue / payments.length : 0;
    return PbmsResponseDto.ok('Lấy báo cáo doanh thu thành công', {
      range,
      totalRevenue,
      successfulPaymentCount: payments.length,
      averagePaymentAmount: avg,
      overview: {
        totalRevenue,
        successfulPaymentCount: payments.length,
        averagePaymentAmount: avg,
        highestRevenueAmount: totalRevenue,
        highestRevenuePeriod: range.groupBy,
        lowestRevenueAmount: 0,
        lowestRevenuePeriod: range.groupBy,
      },
      revenueSeries: this.series(payments, range),
      byPaymentType: this.breakdown(payments, (p) => p.paymentType ?? 'Unknown'),
      byPaymentMethod: this.breakdown(payments, (p) => p.paymentMethod),
      latestPayments: payments.slice(0, 100).map((p) => ({
        paymentId: p.id,
        paymentTime: p.paymentTime,
        paymentType: p.paymentType ?? '',
        paymentMethod: p.paymentMethod,
        amount: toMoney(p.amount),
        paymentStatus: p.paymentStatus,
        transactionReference: p.transactionReference,
      })),
    });
  }

  async operations(query: Record<string, string | undefined>): Promise<PbmsResponseDto> {
    const range = this.normalizeRange(query);
    const entries = await this.prisma.parkingSession.findMany({
      where: { entryTime: { gte: range.from, lte: range.to } },
      include: { vehicleType: true },
    });
    const exits = await this.prisma.parkingSession.findMany({
      where: { exitTime: { gte: range.from, lte: range.to } },
    });
    const reservations = await this.prisma.reservation.findMany({
      where: { createdAt: { gte: range.from, lte: range.to } },
    });
    const incidents = await this.prisma.incidentReport.findMany();
    return PbmsResponseDto.ok('Lấy báo cáo vận hành thành công', {
      range,
      sessions: {
        entries: entries.length,
        exits: exits.length,
        activeSessions: entries.filter((s) => sameStatus(s.status, 'Active')).length,
        completedSessions: exits.filter((s) => sameStatus(s.status, 'Completed')).length,
        averageParkingMinutes: 0,
      },
      reservations: {
        total: reservations.length,
        pending: reservations.filter((r) => sameStatus(r.status, 'Pending')).length,
        confirmed: reservations.filter((r) => sameStatus(r.status, 'Confirmed')).length,
        checkedIn: reservations.filter((r) => sameStatus(r.status, 'CheckedIn')).length,
        completed: reservations.filter((r) => sameStatus(r.status, 'Completed')).length,
        cancelled: reservations.filter((r) => sameStatus(r.status, 'Cancelled')).length,
        noShow: reservations.filter((r) => sameStatus(r.status, 'NoShow')).length,
      },
      incidents: {
        openIncidents: incidents.filter((i) => sameStatus(i.status, 'Open')).length,
        inProgressIncidents: incidents.filter((i) => sameStatus(i.status, 'InProgress')).length,
        resolvedInRange: incidents.filter((i) => sameStatus(i.status, 'Resolved')).length,
        cancelledIncidents: incidents.filter((i) => sameStatus(i.status, 'Cancelled')).length,
      },
      slots: await this.slotOverview(),
      slotOccupancyByFloor: await this.floorOccupancy(),
      sessionsByVehicleType: this.countBreakdown(entries.map((s) => s.vehicleType.typeName)),
      latestSessions: entries.slice(0, 100).map((s) => ({
        sessionId: s.id,
        licensePlate: s.licensePlateIn,
        vehicleTypeName: s.vehicleType.typeName,
        entryTime: s.entryTime,
        exitTime: s.exitTime,
        status: s.status,
      })),
    });
  }

  async exportPdf(query: Record<string, string | undefined>): Promise<StreamableFile | PbmsResponseDto> {
    const format = (query.format ?? query.Format ?? 'pdf').toLowerCase();
    if (format !== 'pdf') {
      return PbmsResponseDto.fail('Định dạng xuất chỉ hỗ trợ pdf');
    }
    const summary = await this.summary(query);
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
    });
    doc.fontSize(18).text('Báo cáo thống kê PBMS', { align: 'center' });
    doc.moveDown();
    doc.fontSize(11).text(JSON.stringify(summary.result, null, 2));
    doc.end();
    const content = await done;
    return new StreamableFile(content, {
      type: 'application/pdf',
      disposition: `attachment; filename="pbms-report.pdf"`,
    });
  }

  private normalizeRange(query: Record<string, string | undefined>): Range {
    const to = query.to || query.To ? new Date(query.to || query.To || '') : new Date();
    const from = query.from || query.From
      ? new Date(query.from || query.From || '')
      : new Date(to.getTime() - 7 * 86400000);
    return {
      from: Number.isNaN(from.getTime()) ? new Date(to.getTime() - 7 * 86400000) : from,
      to: Number.isNaN(to.getTime()) ? new Date() : to,
      groupBy: query.groupBy || query.GroupBy || 'day',
      vehicleTypeId: query.vehicleTypeId || query.VehicleTypeId || null,
    };
  }

  private successfulPayments(range: Range) {
    return this.prisma.payment.findMany({
      where: {
        paymentStatus: 'Success',
        paymentTime: { gte: range.from, lte: range.to },
      },
      orderBy: { paymentTime: 'desc' },
    });
  }

  private async slotOverview() {
    const slots = await this.prisma.parkingSlot.findMany();
    const available = slots.filter((s) => sameStatus(s.status, 'Available')).length;
    const occupied = slots.filter((s) => sameStatus(s.status, 'Occupied')).length;
    const assigned = slots.filter((s) => sameStatus(s.status, 'Assigned')).length;
    return {
      totalSlots: slots.length,
      availableSlots: available,
      occupiedSlots: occupied,
      assignedSlots: assigned,
      utilizationRate: slots.length ? Math.round(((occupied + assigned) / slots.length) * 10000) / 100 : 0,
    };
  }

  private async floorOccupancy() {
    const slots = await this.prisma.parkingSlot.findMany({ include: { floor: true } });
    const map = new Map<
      string,
      {
        floorId: string;
        floorName: string;
        totalSlots: number;
        availableSlots: number;
        occupiedSlots: number;
        assignedSlots: number;
        utilizationRate: number;
      }
    >();
    for (const slot of slots) {
      const current = map.get(slot.floorId) ?? {
        floorId: slot.floorId,
        floorName: slot.floor.floorName,
        totalSlots: 0,
        availableSlots: 0,
        occupiedSlots: 0,
        assignedSlots: 0,
        utilizationRate: 0,
      };
      current.totalSlots += 1;
      if (sameStatus(slot.status, 'Available')) current.availableSlots += 1;
      if (sameStatus(slot.status, 'Occupied')) current.occupiedSlots += 1;
      if (sameStatus(slot.status, 'Assigned')) current.assignedSlots += 1;
      current.utilizationRate = current.totalSlots
        ? Math.round(((current.occupiedSlots + current.assignedSlots) / current.totalSlots) * 10000) / 100
        : 0;
      map.set(slot.floorId, current);
    }
    return [...map.values()];
  }

  private series(payments: Array<{ paymentTime: Date; amount: { toString(): string } }>, range: Range) {
    const byDay = new Map<string, { count: number; amount: number }>();
    for (const payment of payments) {
      const key = payment.paymentTime.toISOString().slice(0, 10);
      const current = byDay.get(key) ?? { count: 0, amount: 0 };
      current.count += 1;
      current.amount += toMoney(payment.amount);
      byDay.set(key, current);
    }
    return [...byDay.entries()].map(([period, value]) => ({
      period,
      count: value.count,
      amount: value.amount,
      groupBy: range.groupBy,
    }));
  }

  private breakdown(
    payments: Array<{ amount: { toString(): string }; paymentType?: string | null; paymentMethod: string }>,
    key: (p: { amount: { toString(): string }; paymentType?: string | null; paymentMethod: string }) => string,
  ) {
    const map = new Map<string, { count: number; amount: number }>();
    const total = payments.reduce((sum, p) => sum + toMoney(p.amount), 0) || 1;
    for (const payment of payments) {
      const name = key(payment);
      const current = map.get(name) ?? { count: 0, amount: 0 };
      current.count += 1;
      current.amount += toMoney(payment.amount);
      map.set(name, current);
    }
    return [...map.entries()].map(([name, value]) => ({
      name,
      count: value.count,
      amount: value.amount,
      percent: Math.round((value.amount / total) * 10000) / 100,
    }));
  }

  private countBreakdown(names: string[]) {
    const map = new Map<string, number>();
    for (const name of names) {
      map.set(name, (map.get(name) ?? 0) + 1);
    }
    return [...map.entries()].map(([name, count]) => ({ name, count, amount: 0, percent: 0 }));
  }

  private metric(key: string, label: string, value: number, unit: string) {
    return { key, label, value, unit };
  }
}
