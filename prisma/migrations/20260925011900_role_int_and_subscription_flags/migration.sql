-- Role PK smallint: 1=customer, 2=staff, 3=manager, 4=admin (gộp User+Customer).
-- users.pbms_role_id (uuid) -> users.role_id (smallint).

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_pbms_role_id_fkey";

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "role_id" SMALLINT;

UPDATE "users" AS u
SET "role_id" = CASE
  WHEN lower(r."role_name") = 'staff' THEN 2
  WHEN lower(r."role_name") = 'manager' THEN 3
  WHEN lower(r."role_name") = 'admin' THEN 4
  ELSE 1
END
FROM "roles" AS r
WHERE u."pbms_role_id" IS NOT NULL AND u."pbms_role_id" = r."id";

UPDATE "users" SET "role_id" = 1 WHERE "role_id" IS NULL;

DROP TABLE IF EXISTS "roles";

CREATE TABLE "roles" (
    "id" SMALLINT NOT NULL,
    "role_name" VARCHAR(50) NOT NULL,
    "description" VARCHAR(255),
    CONSTRAINT "roles_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "roles_role_name_key" UNIQUE ("role_name")
);

INSERT INTO "roles" ("id", "role_name", "description") VALUES
  (1, 'customer', 'Người dùng cuối (mặc định khi đăng ký)'),
  (2, 'staff', 'Nhân viên vận hành'),
  (3, 'manager', 'Quản lý'),
  (4, 'admin', 'Quản trị hệ thống');

ALTER TABLE "users" DROP COLUMN IF EXISTS "pbms_role_id";

ALTER TABLE "users" ALTER COLUMN "role_id" SET NOT NULL;

ALTER TABLE "users" ADD CONSTRAINT "users_role_id_fkey"
  FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

DROP INDEX IF EXISTS "idx_users_pbms_role_id";
CREATE INDEX IF NOT EXISTS "idx_users_role_id" ON "users"("role_id");

ALTER TABLE "subscription_packages" ADD COLUMN IF NOT EXISTS "duration_days" INTEGER;
UPDATE "subscription_packages"
SET "duration_days" = GREATEST("duration_months" * 30, 1)
WHERE "duration_days" IS NULL;
ALTER TABLE "subscription_packages" ALTER COLUMN "duration_days" SET DEFAULT 30;
ALTER TABLE "subscription_packages" ALTER COLUMN "duration_days" SET NOT NULL;

ALTER TABLE "monthly_subscriptions" ADD COLUMN IF NOT EXISTS "auto_renew" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "monthly_subscriptions" ADD COLUMN IF NOT EXISTS "cancelled_at" TIMESTAMPTZ(6);

ALTER TABLE "monthly_subscriptions" DROP CONSTRAINT IF EXISTS "monthly_subscriptions_no_overlap";
ALTER TABLE "monthly_subscriptions"
  ADD CONSTRAINT "monthly_subscriptions_no_overlap"
  EXCLUDE USING gist (
    "license_plate" WITH =,
    tstzrange("start_date", "end_date", '[)') WITH &&
  );
