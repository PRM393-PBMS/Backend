import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';

/**
 * Tạm thời cho database chưa thực sự chạy phần xoá cột của migration
 * 20261012160000_finalize_vehicle_foreign_keys: bảng `reservations` còn `vehicle_type_id`,
 * `monthly_subscriptions` còn `vehicle_type_id` + `license_plate`, đều NOT NULL. Prisma không biết
 * các cột này nên `create()` báo "Null constraint violation". Khi còn cột cũ thì ghi bằng SQL
 * có kèm giá trị (lấy từ xe đã chọn); database đã migrate đúng thì dùng `create()` như thường.
 *
 * Xoá file này sau khi database thật đã chạy `prisma migrate deploy` đầy đủ.
 */
type Db = Pick<Prisma.TransactionClient, '$queryRaw' | '$executeRaw'>;

const LEGACY = ['vehicle_type_id', 'license_plate'];
const cache = new Map<string, Promise<Set<string>>>();

/** Cột cũ còn trong bảng (tra một lần mỗi tiến trình). */
export function legacyColumnsOf(db: Db, table: string): Promise<Set<string>> {
  let found = cache.get(table);
  if (!found) {
    found = db
      .$queryRaw<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = ${table}
          AND column_name IN (${Prisma.join(LEGACY)})`
      .then((rows) => new Set(rows.map((row) => row.column_name)));
    // Lỗi khi tra thì lần sau tra lại, không nhớ kết quả sai.
    found.catch(() => cache.delete(table));
    cache.set(table, found);
  }
  return found;
}

/** Chỉ dùng trong test. */
export function resetLegacyColumnsCache() {
  cache.clear();
}

export async function createReservationRow(
  tx: Prisma.TransactionClient,
  data: { userId: string; vehicleId: string; vehicleTypeId: string; expectedEntryTime: Date; status: string },
) {
  const legacy = await legacyColumnsOf(tx, 'reservations');
  if (!legacy.has('vehicle_type_id')) {
    return tx.reservation.create({
      data: {
        userId: data.userId,
        vehicleId: data.vehicleId,
        expectedEntryTime: data.expectedEntryTime,
        status: data.status,
      },
    });
  }
  const id = randomUUID();
  await tx.$executeRaw`
    INSERT INTO "reservations" ("id", "user_id", "vehicle_id", "vehicle_type_id", "expected_entry_time", "status")
    VALUES (${id}::uuid, ${data.userId}::uuid, ${data.vehicleId}::uuid, ${data.vehicleTypeId}::uuid,
            ${data.expectedEntryTime}::timestamptz, ${data.status})`;
  return tx.reservation.findUniqueOrThrow({ where: { id } });
}

export async function createSubscriptionRow(
  tx: Prisma.TransactionClient,
  data: {
    userId: string;
    vehicle: { id: string; licensePlate: string; vehicleTypeId: string };
    packageId: string;
    startDate: Date;
    endDate: Date;
    price: Prisma.Decimal;
    fixedSlotId: string | null;
    parkingId: string | null;
    autoRenew: boolean;
    status: string;
  },
) {
  const legacy = await legacyColumnsOf(tx, 'monthly_subscriptions');
  if (!legacy.has('vehicle_type_id') && !legacy.has('license_plate')) {
    return tx.monthlySubscription.create({
      data: {
        userId: data.userId,
        vehicleId: data.vehicle.id,
        packageId: data.packageId,
        startDate: data.startDate,
        endDate: data.endDate,
        price: data.price,
        fixedSlotId: data.fixedSlotId,
        parkingId: data.parkingId,
        autoRenew: data.autoRenew,
        status: data.status,
      },
    });
  }
  const id = randomUUID();
  const columns = [
    Prisma.sql`"id"`, Prisma.sql`"user_id"`, Prisma.sql`"vehicle_id"`, Prisma.sql`"package_id"`,
    Prisma.sql`"start_date"`, Prisma.sql`"end_date"`, Prisma.sql`"price"`, Prisma.sql`"fixed_slot_id"`,
    Prisma.sql`"parking_id"`, Prisma.sql`"auto_renew"`, Prisma.sql`"status"`,
  ];
  const values = [
    Prisma.sql`${id}::uuid`, Prisma.sql`${data.userId}::uuid`, Prisma.sql`${data.vehicle.id}::uuid`,
    Prisma.sql`${data.packageId}::uuid`, Prisma.sql`${data.startDate}::timestamptz`,
    Prisma.sql`${data.endDate}::timestamptz`, Prisma.sql`${data.price.toString()}::numeric`,
    Prisma.sql`${data.fixedSlotId}::uuid`, Prisma.sql`${data.parkingId}::uuid`,
    Prisma.sql`${data.autoRenew}`, Prisma.sql`${data.status}`,
  ];
  if (legacy.has('vehicle_type_id')) {
    columns.push(Prisma.sql`"vehicle_type_id"`);
    values.push(Prisma.sql`${data.vehicle.vehicleTypeId}::uuid`);
  }
  if (legacy.has('license_plate')) {
    columns.push(Prisma.sql`"license_plate"`);
    values.push(Prisma.sql`${data.vehicle.licensePlate}`);
  }
  await tx.$executeRaw`
    INSERT INTO "monthly_subscriptions" (${Prisma.join(columns)}) VALUES (${Prisma.join(values)})`;
  return tx.monthlySubscription.findUniqueOrThrow({ where: { id } });
}
