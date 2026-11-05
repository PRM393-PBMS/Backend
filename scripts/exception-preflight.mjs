import { PrismaClient } from '@prisma/client';

// Read-only. Pass DATABASE_URL explicitly or use node --env-file=.env.
const db = new PrismaClient();
const checks = {
  openPlates: `SELECT license_plate_in AS key, count(*)::int AS count FROM parking_sessions WHERE status IN ('Active','Exception') GROUP BY license_plate_in HAVING count(*)>1`,
  openSlots: `SELECT actual_slot_id AS key, count(*)::int AS count FROM parking_sessions WHERE status IN ('Active','Exception') AND actual_slot_id IS NOT NULL GROUP BY actual_slot_id HAVING count(*)>1`,
  entryPasses: `SELECT vehicle_id AS key, count(*)::int AS count FROM entry_passes WHERE status='Active' GROUP BY vehicle_id HAVING count(*)>1`,
  subscriptions: `SELECT vehicle_id AS key, count(*)::int AS count FROM monthly_subscriptions WHERE status IN ('PendingPayment','Active') GROUP BY vehicle_id HAVING count(*)>1`,
  payosOrders: `SELECT transaction_reference AS key, count(*)::int AS count FROM payments WHERE payment_method='PayOS' AND transaction_reference IS NOT NULL AND transaction_reference<>'' GROUP BY transaction_reference HAVING count(*)>1`,
  invalidPayments: `SELECT id FROM payments WHERE amount<0`,
  invalidPackages: `SELECT id FROM subscription_packages WHERE duration_months<=0 OR duration_days<=0 OR price<0 OR (all_parkings AND require_fixed_slot)`,
  invalidPolicies: `SELECT id FROM pricing_policies WHERE base_price<0 OR base_hours<=0 OR extra_hour_price<0 OR night_surcharge<0`,
  slotReferences: `SELECT s.id FROM parking_slots s JOIN floors f ON f.id=s.floor_id WHERE s.parking_id<>f.parking_id OR (f.dedicated_vehicle_type_id IS NOT NULL AND f.dedicated_vehicle_type_id<>s.vehicle_type_id)`,
  capacities: `SELECT f.id FROM floors f WHERE f.total_capacity < (SELECT count(*) FROM parking_slots s WHERE s.floor_id=f.id)`,
};
try {
  let conflicts = 0;
  for (const [name, sql] of Object.entries(checks)) {
    const rows = await db.$queryRawUnsafe(sql); // Static SQL only; never accepts SQL from argv.
    console.log(JSON.stringify({ check: name, rows }));
    conflicts += rows.length;
  }
  console.log(
    JSON.stringify({
      conflicts,
      action: conflicts
        ? 'STOP: review and resolve manually before migrate deploy'
        : 'No conflicts detected for new constraints',
    }),
  );
  process.exitCode = conflicts ? 2 : 0;
} finally {
  await db.$disconnect();
}
