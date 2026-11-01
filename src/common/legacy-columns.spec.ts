import { Prisma } from '@prisma/client';
import { createReservationRow, createSubscriptionRow, resetLegacyColumnsCache } from './legacy-columns';

const userId = '0b6f3c6e-6a64-4c1c-9d5a-2b9c7f3f1a11';
const vehicle = { id: '6e2c1c43-5d8a-4b7e-9a39-0f6c4f2d8b22', licensePlate: '51H12345', vehicleTypeId: '660e8400-e29b-41d4-a716-446655440000' };

function tx(legacy: string[]) {
  return {
    $queryRaw: jest.fn().mockResolvedValue(legacy.map((column_name) => ({ column_name }))),
    $executeRaw: jest.fn().mockResolvedValue(1),
    reservation: {
      create: jest.fn().mockResolvedValue({ id: 'r-new' }),
      findUniqueOrThrow: jest.fn(({ where }: { where: { id: string } }) => Promise.resolve({ id: where.id })),
    },
    monthlySubscription: {
      create: jest.fn().mockResolvedValue({ id: 's-new' }),
      findUniqueOrThrow: jest.fn(({ where }: { where: { id: string } }) => Promise.resolve({ id: where.id })),
    },
  };
}

/** Câu SQL ghép từ template của Prisma, để kiểm tra cột và giá trị. */
function sqlOf(call: unknown[]) {
  const sql = Prisma.sql(call[0] as TemplateStringsArray, ...(call.slice(1) as Prisma.Sql[]));
  return { text: sql.sql, values: sql.values };
}

const reservationData = {
  userId,
  vehicleId: vehicle.id,
  vehicleTypeId: vehicle.vehicleTypeId,
  expectedEntryTime: new Date('2026-11-03T02:00:00Z'),
  status: 'Pending',
};

const subscriptionData = {
  userId,
  vehicle,
  packageId: 'ca60914c-67e2-4e70-8357-a3d3f4d5945b',
  startDate: new Date('2026-11-03T00:00:00Z'),
  endDate: new Date('2026-12-03T00:00:00Z'),
  price: new Prisma.Decimal(300000),
  fixedSlotId: null,
  parkingId: null,
  autoRenew: true,
  status: 'PendingPayment',
};

describe('ghi bản ghi khi database còn / không còn cột cũ', () => {
  beforeEach(() => resetLegacyColumnsCache());

  it('database đã migrate: đặt chỗ tạo bằng Prisma như thường', async () => {
    const db = tx([]);
    await createReservationRow(db as never, reservationData);
    expect(db.reservation.create).toHaveBeenCalledTimes(1);
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });

  it('database còn reservations.vehicle_type_id: ghi kèm loại xe của xe đã chọn', async () => {
    const db = tx(['vehicle_type_id']);
    const created = await createReservationRow(db as never, reservationData);
    expect(db.reservation.create).not.toHaveBeenCalled();
    const { text, values } = sqlOf(db.$executeRaw.mock.calls[0]);
    expect(text).toContain('"vehicle_type_id"');
    expect(values).toContain(vehicle.vehicleTypeId);
    expect(created.id).toBe(values[0]);
  });

  it('database còn cột cũ của vé tháng: ghi kèm loại xe và biển số', async () => {
    const db = tx(['vehicle_type_id', 'license_plate']);
    await createSubscriptionRow(db as never, subscriptionData);
    expect(db.monthlySubscription.create).not.toHaveBeenCalled();
    const { text, values } = sqlOf(db.$executeRaw.mock.calls[0]);
    expect(text).toContain('"vehicle_type_id"');
    expect(text).toContain('"license_plate"');
    expect(values).toEqual(expect.arrayContaining([vehicle.vehicleTypeId, '51H12345', '300000']));
  });

  it('database đã migrate: vé tháng tạo bằng Prisma, tra cột chỉ một lần', async () => {
    const db = tx([]);
    await createSubscriptionRow(db as never, subscriptionData);
    await createSubscriptionRow(db as never, subscriptionData);
    expect(db.monthlySubscription.create).toHaveBeenCalledTimes(2);
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
  });
});
