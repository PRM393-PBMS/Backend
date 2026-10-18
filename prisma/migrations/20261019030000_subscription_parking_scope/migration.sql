-- Vé tháng theo bãi + gói "mọi bãi"
ALTER TABLE "subscription_packages" ADD COLUMN "all_parkings" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "monthly_subscriptions" ADD COLUMN "parking_id" UUID;
ALTER TABLE "monthly_subscriptions" ADD CONSTRAINT "monthly_subscriptions_parking_id_fkey"
    FOREIGN KEY ("parking_id") REFERENCES "parkings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "idx_monthly_subscriptions_parking_id" ON "monthly_subscriptions"("parking_id");

-- Vé cũ: gán bãi của ô cố định; không có ô thì gán bãi duy nhất (nếu hệ thống chỉ có một bãi).
UPDATE "monthly_subscriptions" s
SET "parking_id" = ps."parking_id"
FROM "parking_slots" ps
WHERE s."fixed_slot_id" = ps."id" AND s."parking_id" IS NULL;

UPDATE "monthly_subscriptions"
SET "parking_id" = (SELECT "id" FROM "parkings" LIMIT 1)
WHERE "parking_id" IS NULL AND (SELECT count(*) FROM "parkings") = 1;

-- Gói 1 tháng "mọi bãi" cho mỗi loại xe đang có gói 1 tháng: giá mặc định 1,5 lần gói một bãi
-- (làm tròn nghìn đồng), không cố định ô. Quản lý chỉnh giá trong danh mục gói.
INSERT INTO "subscription_packages"
    ("id", "package_name", "vehicle_type_id", "duration_months", "duration_days",
     "price", "require_fixed_slot", "all_parkings", "description", "status")
SELECT gen_random_uuid(),
       'Gói tháng mọi bãi ' || lower(vt."type_name"),
       base."vehicle_type_id",
       1,
       30,
       round(base."price" * 1.5, -3),
       false,
       true,
       'Gửi ' || lower(vt."type_name") || ' ở mọi bãi PBMS trong 1 tháng, không cố định ô',
       'Active'
FROM (
    SELECT DISTINCT ON ("vehicle_type_id") *
    FROM "subscription_packages"
    WHERE "duration_months" = 1 AND "status" = 'Active' AND "all_parkings" = false
    ORDER BY "vehicle_type_id", "price"
) AS base
JOIN "vehicle_types" vt ON vt."id" = base."vehicle_type_id"
WHERE NOT EXISTS (
    SELECT 1 FROM "subscription_packages" q
    WHERE q."vehicle_type_id" = base."vehicle_type_id" AND q."all_parkings" = true
);
