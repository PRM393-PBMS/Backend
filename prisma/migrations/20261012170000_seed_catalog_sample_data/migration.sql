-- Idempotent catalog data used by the API's Swagger examples and local demos.
-- Existing catalog records are deliberately preserved.

INSERT INTO "vehicle_types" ("id", "type_name", "dimensions")
VALUES
  ('550e8400-e29b-41d4-a716-446655440000', 'Xe máy', '2.0m x 0.8m'),
  ('660e8400-e29b-41d4-a716-446655440000', 'Ô tô', '5.0m x 2.5m')
ON CONFLICT ("type_name") DO NOTHING;

INSERT INTO "parkings" ("id", "name", "location", "created_at", "updated_at")
VALUES (
  'c56a4180-65aa-42ec-a945-5fd21dec0538',
  'Bãi đỗ trung tâm',
  'Khu A - FPT University HCM',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("name") DO NOTHING;

INSERT INTO "floors" (
  "id", "parking_id", "floor_name", "dedicated_vehicle_type_id", "total_capacity", "is_resident"
)
SELECT
  '6ec0bd7f-11c0-43da-975e-2a8ad9ebae0b',
  p."id",
  'Tầng B1',
  vt."id",
  50,
  false
FROM "parkings" AS p
CROSS JOIN "vehicle_types" AS vt
WHERE p."name" = 'Bãi đỗ trung tâm'
  AND vt."type_name" = 'Xe máy'
  AND NOT EXISTS (SELECT 1 FROM "floors" WHERE "floor_name" = 'Tầng B1');

INSERT INTO "floors" (
  "id", "parking_id", "floor_name", "dedicated_vehicle_type_id", "total_capacity", "is_resident"
)
SELECT
  '7ec0bd7f-11c0-43da-975e-2a8ad9ebae0b',
  p."id",
  'Tầng B2',
  vt."id",
  30,
  true
FROM "parkings" AS p
CROSS JOIN "vehicle_types" AS vt
WHERE p."name" = 'Bãi đỗ trung tâm'
  AND vt."type_name" = 'Ô tô'
  AND NOT EXISTS (SELECT 1 FROM "floors" WHERE "floor_name" = 'Tầng B2');

INSERT INTO "gates" ("id", "gate_name", "gate_type", "floor_id")
SELECT '7c9e6679-7425-40de-944b-e07fc1f90ae7', 'Cổng vào A', 'Entry', f."id"
FROM "floors" AS f
WHERE f."floor_name" = 'Tầng B1'
  AND NOT EXISTS (
    SELECT 1 FROM "gates" AS g
    WHERE g."floor_id" = f."id" AND g."gate_name" = 'Cổng vào A' AND g."gate_type" = 'Entry'
  );

INSERT INTO "gates" ("id", "gate_name", "gate_type", "floor_id")
SELECT '11111111-2222-4333-8444-555555555555', 'Cổng ra A', 'Exit', f."id"
FROM "floors" AS f
WHERE f."floor_name" = 'Tầng B1'
  AND NOT EXISTS (
    SELECT 1 FROM "gates" AS g
    WHERE g."floor_id" = f."id" AND g."gate_name" = 'Cổng ra A' AND g."gate_type" = 'Exit'
  );

INSERT INTO "gates" ("id", "gate_name", "gate_type", "floor_id")
SELECT '8c9e6679-7425-40de-944b-e07fc1f90ae7', 'Cổng vào B', 'Entry', f."id"
FROM "floors" AS f
WHERE f."floor_name" = 'Tầng B2'
  AND NOT EXISTS (
    SELECT 1 FROM "gates" AS g
    WHERE g."floor_id" = f."id" AND g."gate_name" = 'Cổng vào B' AND g."gate_type" = 'Entry'
  );

INSERT INTO "gates" ("id", "gate_name", "gate_type", "floor_id")
SELECT '22222222-3333-4444-8555-666666666666', 'Cổng ra B', 'Exit', f."id"
FROM "floors" AS f
WHERE f."floor_name" = 'Tầng B2'
  AND NOT EXISTS (
    SELECT 1 FROM "gates" AS g
    WHERE g."floor_id" = f."id" AND g."gate_name" = 'Cổng ra B' AND g."gate_type" = 'Exit'
  );

INSERT INTO "parking_slots" (
  "id", "parking_id", "floor_id", "slot_code", "vehicle_type_id", "status"
)
SELECT
  'f47ac10b-58cc-4372-a567-0e02b2c3d479', p."id", f."id", 'B1-A12', vt."id", 'Available'
FROM "parkings" AS p
JOIN "floors" AS f ON f."parking_id" = p."id" AND f."floor_name" = 'Tầng B1'
JOIN "vehicle_types" AS vt ON vt."type_name" = 'Xe máy'
WHERE p."name" = 'Bãi đỗ trung tâm'
ON CONFLICT ("parking_id", "slot_code") DO NOTHING;

INSERT INTO "parking_slots" (
  "id", "parking_id", "floor_id", "slot_code", "vehicle_type_id", "status"
)
SELECT
  gen_random_uuid(), p."id", f."id", 'B1-A' || LPAD(n::text, 2, '0'), vt."id", 'Available'
FROM generate_series(1, 50) AS n
CROSS JOIN "parkings" AS p
JOIN "floors" AS f ON f."parking_id" = p."id" AND f."floor_name" = 'Tầng B1'
JOIN "vehicle_types" AS vt ON vt."type_name" = 'Xe máy'
WHERE p."name" = 'Bãi đỗ trung tâm'
ON CONFLICT ("parking_id", "slot_code") DO NOTHING;

INSERT INTO "parking_slots" (
  "id", "parking_id", "floor_id", "slot_code", "vehicle_type_id", "status"
)
SELECT
  gen_random_uuid(), p."id", f."id", 'B2-C' || LPAD(n::text, 2, '0'), vt."id", 'Available'
FROM generate_series(1, 30) AS n
CROSS JOIN "parkings" AS p
JOIN "floors" AS f ON f."parking_id" = p."id" AND f."floor_name" = 'Tầng B2'
JOIN "vehicle_types" AS vt ON vt."type_name" = 'Ô tô'
WHERE p."name" = 'Bãi đỗ trung tâm'
ON CONFLICT ("parking_id", "slot_code") DO NOTHING;

INSERT INTO "pricing_policies" (
  "id", "vehicle_type_id", "base_price", "base_hours", "extra_hour_price", "night_surcharge", "effective_date", "status"
)
SELECT '3fa85f64-5717-4562-b3fc-2c963f66afa6', vt."id", 5000, 1, 3000, 2000, '2026-10-12T00:00:00Z', 'Active'
FROM "vehicle_types" AS vt
WHERE vt."type_name" = 'Xe máy'
  AND NOT EXISTS (
    SELECT 1 FROM "pricing_policies" AS pp
    WHERE pp."vehicle_type_id" = vt."id" AND pp."effective_date" = '2026-10-12T00:00:00Z'
  );

INSERT INTO "pricing_policies" (
  "id", "vehicle_type_id", "base_price", "base_hours", "extra_hour_price", "night_surcharge", "effective_date", "status"
)
SELECT '4fa85f64-5717-4562-b3fc-2c963f66afa6', vt."id", 10000, 1, 5000, 3000, '2026-10-12T00:00:00Z', 'Active'
FROM "vehicle_types" AS vt
WHERE vt."type_name" = 'Ô tô'
  AND NOT EXISTS (
    SELECT 1 FROM "pricing_policies" AS pp
    WHERE pp."vehicle_type_id" = vt."id" AND pp."effective_date" = '2026-10-12T00:00:00Z'
  );

INSERT INTO "subscription_packages" (
  "id", "package_name", "vehicle_type_id", "duration_months", "duration_days", "price", "require_fixed_slot", "description", "status"
)
SELECT '1b4e28ba-2fa1-11d2-883f-0016d3cca427', 'Gói tháng xe máy', vt."id", 1, 30, 300000, false,
  'Gói gửi xe máy theo tháng', 'Active'
FROM "vehicle_types" AS vt
WHERE vt."type_name" = 'Xe máy'
  AND NOT EXISTS (SELECT 1 FROM "subscription_packages" WHERE "package_name" = 'Gói tháng xe máy');

INSERT INTO "subscription_packages" (
  "id", "package_name", "vehicle_type_id", "duration_months", "duration_days", "price", "require_fixed_slot", "description", "status"
)
SELECT '2b4e28ba-2fa1-11d2-883f-0016d3cca427', 'Gói tháng ô tô', vt."id", 1, 30, 1500000, true,
  'Gói gửi ô tô theo tháng kèm ô cố định', 'Active'
FROM "vehicle_types" AS vt
WHERE vt."type_name" = 'Ô tô'
  AND NOT EXISTS (SELECT 1 FROM "subscription_packages" WHERE "package_name" = 'Gói tháng ô tô');
