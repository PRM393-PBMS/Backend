import { firstValueFrom, take } from 'rxjs';
import { FilesService } from '../integrations/payos-files.service';
import { PlateRecognizerService } from '../integrations/plate-recognizer.service';
import { PrismaService } from '../prisma/prisma.service';
import { GateScansService } from './gate-scans.service';

const gateId = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const staffId = '0b6f3c6e-6a64-4c1c-9d5a-2b9c7f3f1a11';
const file = { buffer: Buffer.from('img'), originalname: 'plate.jpg', mimetype: 'image/jpeg' };

function setup(opts: {
  plate?: string | null;
  gateType?: string;
  reservations?: object[];
  subscription?: object | null;
  activeSession?: object | null;
} = {}) {
  const created: Record<string, unknown>[] = [];
  const prisma = {
    gate: {
      findUnique: jest.fn().mockResolvedValue({
        id: gateId,
        gateType: opts.gateType ?? 'Entry',
        floor: { parkingId: 'p1' },
      }),
    },
    parkingSession: { findFirst: jest.fn().mockResolvedValue(opts.activeSession ?? null) },
    reservation: { findMany: jest.fn().mockResolvedValue(opts.reservations ?? []) },
    monthlySubscription: { findFirst: jest.fn().mockResolvedValue(opts.subscription ?? null) },
    vehicle: { findFirst: jest.fn().mockResolvedValue(null) },
    gateScan: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return Promise.resolve({
          id: 'scan-1',
          ...data,
          createdAt: new Date(),
          status: 'New',
          handledAt: null,
          match: data.match,
          gate: { gateName: 'Cổng A', gateType: opts.gateType ?? 'Entry', floor: { floorName: 'B1' } },
          scannedBy: { id: staffId, fullName: 'Nhân viên A', userName: null, email: 'a@pbms.vn' },
        });
      }),
    },
  };
  const files = { saveUpload: jest.fn().mockResolvedValue({ imageUrl: 'http://h/uploads/gate-scans/x.jpg' }) };
  const plates = {
    recognize: jest.fn().mockResolvedValue({
      licensePlate: opts.plate === undefined ? '51h-123.45' : opts.plate,
      confidence: 0.91,
    }),
  };
  const service = new GateScansService(
    prisma as unknown as PrismaService,
    files as unknown as FilesService,
    plates as unknown as PlateRecognizerService,
  );
  return { service, prisma, files, plates, created };
}

describe('GateScansService.create', () => {
  it('lưu ảnh, chuẩn hoá biển số, gắn nhân viên và phát sự kiện cho đúng cổng', async () => {
    const { service, created } = setup();
    const events = firstValueFrom(service.stream(gateId).pipe(take(1)));
    const res = await service.create(staffId, file, { gateId, baseUrl: 'http://h' });

    expect(res.isSuccess).toBe(true);
    expect(created[0]).toMatchObject({
      gateId,
      scannedById: staffId,
      licensePlate: '51H12345',
      suggestedType: 'Guest',
    });
    const event = await events;
    expect(event.type).toBe('scan');
    expect(event.data).toMatchObject({
      licensePlate: '51H12345',
      scannedBy: { userId: staffId, fullName: 'Nhân viên A' },
      imageUrl: 'http://h/uploads/gate-scans/x.jpg',
    });
  });

  it('báo đặt chỗ gần giờ quét nhất, đúng giờ trong ±30 phút', async () => {
    const now = Date.now();
    const { service, created } = setup({
      reservations: [
        { id: 'far', status: 'Confirmed', expectedEntryTime: new Date(now + 5 * 3600_000), user: null, vehicle: null },
        {
          id: 'near',
          status: 'Confirmed',
          expectedEntryTime: new Date(now + 10 * 60_000),
          user: { fullName: 'Khách B', phoneNumber: '0901' },
          vehicle: { vehicleType: { typeName: 'Ô tô' } },
        },
      ],
    });
    await service.create(staffId, file, { gateId, baseUrl: 'http://h' });
    expect(created[0]).toMatchObject({ suggestedType: 'Reservation', reservationId: 'near' });
    expect((created[0].match as { reservation: object }).reservation).toMatchObject({
      onTime: true,
      customerName: 'Khách B',
    });
  });

  it('xe đang trong bãi được ưu tiên báo, kể cả khi có đặt chỗ', async () => {
    const { service, created } = setup({
      reservations: [{ id: 'r', status: 'Confirmed', expectedEntryTime: new Date(), user: null, vehicle: null }],
      activeSession: { id: 's1', entryTime: new Date(), entryGate: { gateName: 'Cổng A' } },
    });
    await service.create(staffId, file, { gateId, baseUrl: 'http://h' });
    expect(created[0].suggestedType).toBe('Inside');
  });

  it('cổng ra: có phiên đang mở thì gợi ý checkout', async () => {
    const { service, created } = setup({
      gateType: 'Exit',
      activeSession: { id: 's1', entryTime: new Date(), entryGate: null },
    });
    await service.create(staffId, file, { gateId, baseUrl: 'http://h' });
    expect(created[0].suggestedType).toBe('Checkout');
  });

  it('không đọc được biển số vẫn gửi ảnh lên web để nhân viên nhập tay', async () => {
    const { service, prisma, created } = setup({ plate: null });
    const res = await service.create(staffId, file, { gateId, baseUrl: 'http://h' });
    expect(res.isSuccess).toBe(true);
    expect(created[0]).toMatchObject({ licensePlate: null, suggestedType: 'Unknown', reservationId: null });
    expect(prisma.reservation.findMany).not.toHaveBeenCalled();
  });

  it('nhận diện lỗi (dịch vụ ngoài) không làm hỏng lượt quét', async () => {
    const { service, plates, created } = setup();
    plates.recognize.mockRejectedValue(new Error('timeout'));
    const res = await service.create(staffId, file, { gateId, baseUrl: 'http://h' });
    expect(res.isSuccess).toBe(true);
    expect(created[0].licensePlate).toBeNull();
  });

  it('thiếu cổng thì từ chối, không lưu ảnh', async () => {
    const { service, files } = setup();
    const res = await service.create(staffId, file, { baseUrl: 'http://h' });
    expect(res.isSuccess).toBe(false);
    expect(files.saveUpload).not.toHaveBeenCalled();
  });

  it('giờ chụp lệch quá 10 phút thì lấy giờ máy chủ', async () => {
    const { service, created } = setup();
    await service.create(staffId, file, { gateId, baseUrl: 'http://h', capturedAt: '2020-01-01T00:00:00Z' });
    expect(Math.abs((created[0].capturedAt as Date).getTime() - Date.now())).toBeLessThan(5000);
  });
});

describe('GateScansService.stream', () => {
  it('chỉ nhận lượt quét của cổng đang theo dõi', async () => {
    const { service } = setup();
    const other: unknown[] = [];
    const mine: unknown[] = [];
    const subs = [
      service.stream('other-gate').subscribe((e) => other.push(e)),
      service.stream(gateId).subscribe((e) => mine.push(e)),
    ];
    await service.create(staffId, file, { gateId, baseUrl: 'http://h' });
    subs.forEach((s) => s.unsubscribe());
    expect(other).toHaveLength(0);
    expect(mine).toHaveLength(1);
  });
});
