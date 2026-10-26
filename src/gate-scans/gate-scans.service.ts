import { Injectable, Logger, MessageEvent } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Observable, Subject, filter, interval, map, merge } from 'rxjs';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import { isValidLicensePlate, normalizeLicensePlate } from '../common/license-plate';
import { FilesService } from '../integrations/payos-files.service';
import { PlateRecognizerService } from '../integrations/plate-recognizer.service';
import { PrismaService } from '../prisma/prisma.service';

/** Đặt chỗ hợp lệ ở cổng trong ±30 phút quanh giờ hẹn (như check-in). */
const ON_TIME_MS = 30 * 60 * 1000;
/** Đặt chỗ trong ±12 giờ vẫn được báo cho web, kèm cờ đúng giờ hay không. */
const LOOKUP_WINDOW_MS = 12 * 60 * 60 * 1000;
/** Đồng hồ điện thoại lệch quá 10 phút thì lấy giờ máy chủ. */
const MAX_CLOCK_SKEW_MS = 10 * 60 * 1000;
const HEARTBEAT_MS = 25_000;
const SCAN_STATUSES = ['New', 'Handled', 'Dismissed'] as const;

export type SuggestedType = 'Reservation' | 'Resident' | 'Guest' | 'Inside' | 'Checkout' | 'Unknown';

export interface GateScanMatch {
  reservation: {
    reservationId: string;
    status: string;
    expectedEntryTime: string;
    onTime: boolean;
    customerName: string | null;
    phoneNumber: string | null;
    vehicleTypeName: string | null;
  } | null;
  subscription: { subscriptionId: string; packageName: string | null; endDate: string } | null;
  activeSession: { sessionId: string; entryTime: string; entryGateName: string | null } | null;
  vehicle: { vehicleTypeId: string; vehicleTypeName: string | null; ownerName: string | null } | null;
}

const scanInclude = {
  gate: { select: { gateName: true, gateType: true, floor: { select: { floorName: true } } } },
  scannedBy: { select: { id: true, fullName: true, userName: true, email: true } },
} satisfies Prisma.GateScanInclude;

type ScanRow = Prisma.GateScanGetPayload<{ include: typeof scanInclude }>;

interface ScanEvent {
  gateId: string;
  type: 'scan' | 'scan-updated';
  data: object;
}

/**
 * Lượt quét biển số từ điện thoại nhân viên: lưu ảnh, nhận diện, đối chiếu đặt chỗ / gói tháng /
 * phiên đang mở, rồi đẩy real-time (SSE) cho web staff đang mở đúng cổng.
 * Kênh phát nằm trong bộ nhớ: đủ cho một tiến trình máy chủ (Render một instance).
 */
@Injectable()
export class GateScansService {
  private readonly logger = new Logger(GateScansService.name);
  private readonly events = new Subject<ScanEvent>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly plates: PlateRecognizerService,
  ) {}

  async create(
    staffId: string,
    file: import('../common/uploaded-image').UploadedImage,
    input: { gateId?: string; capturedAt?: string; baseUrl: string },
  ): Promise<PbmsResponseDto> {
    const gate = input.gateId
      ? await this.prisma.gate.findUnique({
          where: { id: input.gateId },
          select: { id: true, gateType: true, floor: { select: { parkingId: true } } },
        })
      : null;
    if (!gate) {
      return PbmsResponseDto.fail('Vui lòng chọn cổng đang đứng quét', 400);
    }
    const capturedAt = this.parseCapturedAt(input.capturedAt);
    const upload = await this.files.saveUpload(file, input.baseUrl, 'gate-scans');

    let plate: string | null = null;
    let confidence: number | null = null;
    try {
      const result = await this.plates.recognize(file, upload.imageUrl);
      plate = result.licensePlate ? normalizeLicensePlate(result.licensePlate) : null;
      confidence = result.confidence ?? null;
    } catch (error) {
      // Không đọc được biển số vẫn gửi ảnh lên web để nhân viên tự nhập.
      this.logger.warn(`Nhận diện biển số lỗi: ${(error as Error).message}`);
    }
    if (plate && !isValidLicensePlate(plate)) plate = null;

    const match = plate ? await this.lookup(plate, gate.floor.parkingId, capturedAt) : null;
    const suggestedType = this.suggest(gate.gateType, plate, match);

    const scan = await this.prisma.gateScan.create({
      data: {
        gateId: gate.id,
        scannedById: staffId,
        imageUrl: upload.imageUrl,
        licensePlate: plate,
        confidence,
        capturedAt,
        suggestedType,
        reservationId: match?.reservation?.reservationId ?? null,
        match: match ? (match as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
      include: scanInclude,
    });
    const dto = this.toDto(scan);
    this.events.next({ gateId: gate.id, type: 'scan', data: dto });
    return PbmsResponseDto.ok(
      plate ? `Đã gửi biển số ${plate} lên web` : 'Đã gửi ảnh lên web, chưa đọc được biển số',
      dto,
      201,
    );
  }

  async recent(filters: { gateId?: string; staffId?: string; limit?: number }): Promise<PbmsResponseDto> {
    const rows = await this.prisma.gateScan.findMany({
      where: {
        ...(filters.gateId ? { gateId: filters.gateId } : {}),
        ...(filters.staffId ? { scannedById: filters.staffId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(filters.limit || 20, 1), 100),
      include: scanInclude,
    });
    return PbmsResponseDto.ok('Lấy lượt quét gần đây thành công', rows.map((r) => this.toDto(r)));
  }

  async setStatus(id: string, status: string | undefined): Promise<PbmsResponseDto> {
    const next = SCAN_STATUSES.find((s) => s.toLowerCase() === (status ?? '').trim().toLowerCase());
    if (!next) {
      return PbmsResponseDto.fail('Status phải là New, Handled hoặc Dismissed', 400);
    }
    const found = await this.prisma.gateScan.findUnique({ where: { id }, select: { id: true } });
    if (!found) {
      return PbmsResponseDto.fail('Không tìm thấy lượt quét', 404);
    }
    const scan = await this.prisma.gateScan.update({
      where: { id },
      data: { status: next, handledAt: next === 'New' ? null : new Date() },
      include: scanInclude,
    });
    const dto = this.toDto(scan);
    this.events.next({ gateId: scan.gateId, type: 'scan-updated', data: dto });
    return PbmsResponseDto.ok('Cập nhật lượt quét thành công', dto);
  }

  /** Luồng SSE theo cổng (bỏ trống = mọi cổng), kèm nhịp giữ kết nối mỗi 25 giây. */
  stream(gateId?: string): Observable<MessageEvent> {
    const scans = this.events.pipe(
      filter((e) => !gateId || e.gateId === gateId),
      map((e): MessageEvent => ({ type: e.type, data: e.data })),
    );
    const heartbeat = interval(HEARTBEAT_MS).pipe(
      map((): MessageEvent => ({ type: 'ping', data: { at: new Date().toISOString() } })),
    );
    return merge(scans, heartbeat);
  }

  async lookup(plate: string, parkingId: string | null, at: Date): Promise<GateScanMatch> {
    const [activeSession, reservations, subscription, vehicle] = await Promise.all([
      this.prisma.parkingSession.findFirst({
        where: { licensePlateIn: plate, status: 'Active' },
        select: { id: true, entryTime: true, entryGate: { select: { gateName: true } } },
      }),
      this.prisma.reservation.findMany({
        where: {
          vehicle: { is: { licensePlate: plate } },
          status: { in: ['Confirmed', 'Modified'] },
          expectedEntryTime: {
            gte: new Date(at.getTime() - LOOKUP_WINDOW_MS),
            lte: new Date(at.getTime() + LOOKUP_WINDOW_MS),
          },
        },
        take: 5,
        include: {
          user: { select: { fullName: true, phoneNumber: true } },
          vehicle: { select: { vehicleType: { select: { typeName: true } } } },
        },
      }),
      this.prisma.monthlySubscription.findFirst({
        where: {
          vehicle: { is: { licensePlate: plate } },
          status: 'Active',
          startDate: { lte: at },
          endDate: { gte: at },
          ...(parkingId
            ? { OR: [{ parkingId }, { parkingId: null }, { package: { is: { allParkings: true } } }] }
            : {}),
        },
        select: { id: true, endDate: true, package: { select: { packageName: true } } },
      }),
      this.prisma.vehicle.findFirst({
        where: { licensePlate: plate },
        select: {
          vehicleTypeId: true,
          vehicleType: { select: { typeName: true } },
          user: { select: { fullName: true } },
        },
      }),
    ]);

    // Đặt chỗ có giờ hẹn gần lúc quét nhất.
    const gap = (d: Date) => Math.abs(d.getTime() - at.getTime());
    const nearest = [...reservations].sort((a, b) => gap(a.expectedEntryTime) - gap(b.expectedEntryTime))[0];

    return {
      reservation: nearest
        ? {
            reservationId: nearest.id,
            status: nearest.status,
            expectedEntryTime: nearest.expectedEntryTime.toISOString(),
            onTime: gap(nearest.expectedEntryTime) <= ON_TIME_MS,
            customerName: nearest.user?.fullName ?? null,
            phoneNumber: nearest.user?.phoneNumber ?? null,
            vehicleTypeName: nearest.vehicle?.vehicleType?.typeName ?? null,
          }
        : null,
      subscription: subscription
        ? {
            subscriptionId: subscription.id,
            packageName: subscription.package?.packageName ?? null,
            endDate: subscription.endDate.toISOString(),
          }
        : null,
      activeSession: activeSession
        ? {
            sessionId: activeSession.id,
            entryTime: activeSession.entryTime.toISOString(),
            entryGateName: activeSession.entryGate?.gateName ?? null,
          }
        : null,
      vehicle: vehicle
        ? {
            vehicleTypeId: vehicle.vehicleTypeId,
            vehicleTypeName: vehicle.vehicleType?.typeName ?? null,
            ownerName: vehicle.user?.fullName ?? null,
          }
        : null,
    };
  }

  /** Gợi ý cách xử lý cho web: cổng ra cần phiên đang mở; cổng vào ưu tiên xe đã trong bãi > gói tháng > đặt chỗ > vãng lai. */
  suggest(gateType: string, plate: string | null, match: GateScanMatch | null): SuggestedType {
    if (!plate || !match) return 'Unknown';
    if (gateType.trim().toLowerCase() === 'exit') {
      return match.activeSession ? 'Checkout' : 'Unknown';
    }
    if (match.activeSession) return 'Inside';
    if (match.subscription) return 'Resident';
    if (match.reservation) return 'Reservation';
    return 'Guest';
  }

  private parseCapturedAt(value?: string): Date {
    const now = new Date();
    const parsed = value ? new Date(value) : null;
    if (!parsed || Number.isNaN(parsed.getTime()) || Math.abs(parsed.getTime() - now.getTime()) > MAX_CLOCK_SKEW_MS) {
      return now;
    }
    return parsed;
  }

  private toDto(scan: ScanRow) {
    const staff = scan.scannedBy;
    return {
      scanId: scan.id,
      gateId: scan.gateId,
      gateName: scan.gate.gateName,
      gateType: scan.gate.gateType,
      floorName: scan.gate.floor?.floorName ?? null,
      imageUrl: scan.imageUrl,
      licensePlate: scan.licensePlate,
      confidence: scan.confidence,
      capturedAt: scan.capturedAt.toISOString(),
      receivedAt: scan.createdAt.toISOString(),
      scannedBy: { userId: staff.id, fullName: staff.fullName ?? staff.userName ?? staff.email },
      suggestedType: scan.suggestedType,
      reservationId: scan.reservationId,
      match: (scan.match ?? null) as GateScanMatch | null,
      status: scan.status,
      handledAt: scan.handledAt?.toISOString() ?? null,
    };
  }
}
