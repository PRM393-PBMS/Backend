-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN', 'MODERATOR');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "first_name" VARCHAR(100),
    "last_name" VARCHAR(100),
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_email_verified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "user_name" VARCHAR(50),
    "full_name" VARCHAR(100),
    "phone_number" VARCHAR(15),
    "status" VARCHAR(20) DEFAULT 'Active',
    "pbms_role_id" UUID,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(255) NOT NULL,
    "device_info" VARCHAR(255),
    "ip_address" VARCHAR(45),
    "is_revoked" BOOLEAN NOT NULL DEFAULT false,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "role_name" VARCHAR(50) NOT NULL,
    "description" VARCHAR(255),

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_types" (
    "id" UUID NOT NULL,
    "type_name" VARCHAR(50) NOT NULL,
    "dimensions" VARCHAR(50),

    CONSTRAINT "vehicle_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "floors" (
    "id" UUID NOT NULL,
    "floor_name" VARCHAR(50) NOT NULL,
    "dedicated_vehicle_type_id" UUID,
    "total_capacity" INTEGER NOT NULL,
    "is_resident" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "floors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gates" (
    "id" UUID NOT NULL,
    "gate_name" VARCHAR(50) NOT NULL,
    "gate_type" VARCHAR(10) NOT NULL,
    "floor_id" UUID NOT NULL,

    CONSTRAINT "gates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parking_slots" (
    "id" UUID NOT NULL,
    "floor_id" UUID NOT NULL,
    "slot_code" VARCHAR(15) NOT NULL,
    "vehicle_type_id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'Available',
    "assigned_user_id" UUID,

    CONSTRAINT "parking_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_policies" (
    "id" UUID NOT NULL,
    "vehicle_type_id" UUID NOT NULL,
    "base_price" DECIMAL(15,2) NOT NULL,
    "base_hours" INTEGER NOT NULL,
    "extra_hour_price" DECIMAL(15,2) NOT NULL,
    "night_surcharge" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "effective_date" TIMESTAMPTZ(6) NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'Active',

    CONSTRAINT "pricing_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_packages" (
    "id" UUID NOT NULL,
    "package_name" VARCHAR(100) NOT NULL,
    "vehicle_type_id" UUID NOT NULL,
    "duration_months" INTEGER NOT NULL,
    "price" DECIMAL(15,2) NOT NULL,
    "require_fixed_slot" BOOLEAN NOT NULL DEFAULT false,
    "description" VARCHAR(500),
    "status" VARCHAR(10) NOT NULL DEFAULT 'Active',

    CONSTRAINT "subscription_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monthly_subscriptions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "vehicle_type_id" UUID NOT NULL,
    "license_plate" VARCHAR(15) NOT NULL,
    "package_id" UUID NOT NULL,
    "start_date" TIMESTAMPTZ(6) NOT NULL,
    "end_date" TIMESTAMPTZ(6) NOT NULL,
    "price" DECIMAL(15,2) NOT NULL,
    "fixed_slot_id" UUID,
    "status" VARCHAR(30) NOT NULL DEFAULT 'Active',

    CONSTRAINT "monthly_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_renewals" (
    "id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "old_end_date" TIMESTAMPTZ(6) NOT NULL,
    "new_end_date" TIMESTAMPTZ(6) NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "renewal_date" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_renewals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_change_requests" (
    "id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "old_license_plate" VARCHAR(15) NOT NULL,
    "new_license_plate" VARCHAR(15) NOT NULL,
    "reason" VARCHAR(500),
    "rejection_reason" VARCHAR(500),
    "status" VARCHAR(15) NOT NULL DEFAULT 'Pending',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),
    "handled_by_staff_id" UUID,

    CONSTRAINT "vehicle_change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "vehicle_type_id" UUID NOT NULL,
    "expected_entry_time" TIMESTAMPTZ(6) NOT NULL,
    "status" VARCHAR(15) NOT NULL DEFAULT 'Pending',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parking_sessions" (
    "id" UUID NOT NULL,
    "reservation_id" UUID,
    "driver_user_id" UUID,
    "license_plate_in" VARCHAR(15) NOT NULL,
    "license_plate_out" VARCHAR(15),
    "entry_image_url" TEXT,
    "driver_entry_image_url" TEXT,
    "exit_image_url" TEXT,
    "driver_exit_image_url" TEXT,
    "vehicle_type_id" UUID NOT NULL,
    "entry_time" TIMESTAMPTZ(6) NOT NULL,
    "exit_time" TIMESTAMPTZ(6),
    "entry_gate_id" UUID NOT NULL,
    "exit_gate_id" UUID,
    "assigned_slot_id" UUID,
    "actual_slot_id" UUID,
    "status" VARCHAR(15) NOT NULL DEFAULT 'Active',

    CONSTRAINT "parking_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "session_id" UUID,
    "reservation_id" UUID,
    "subscription_id" UUID,
    "amount" DECIMAL(15,2) NOT NULL,
    "payment_method" VARCHAR(20) NOT NULL,
    "payment_type" VARCHAR(30),
    "payment_time" TIMESTAMPTZ(6) NOT NULL,
    "payment_status" VARCHAR(10) NOT NULL DEFAULT 'Pending',
    "transaction_reference" VARCHAR(100),

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incident_reports" (
    "id" UUID NOT NULL,
    "session_id" UUID,
    "reported_by_user_id" UUID NOT NULL,
    "issue_type" VARCHAR(255) NOT NULL,
    "description" TEXT NOT NULL,
    "proof_image_url" TEXT,
    "status" VARCHAR(15) NOT NULL DEFAULT 'Open',
    "handled_by_staff_id" UUID,
    "resolved_at" TIMESTAMPTZ(6),
    "resolution_notes" TEXT,

    CONSTRAINT "incident_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_user_name_key" ON "users"("user_name");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_number_key" ON "users"("phone_number");

-- CreateIndex
CREATE INDEX "idx_users_role_is_active" ON "users"("role", "is_active");

-- CreateIndex
CREATE INDEX "idx_users_pbms_role_id" ON "users"("pbms_role_id");

-- CreateIndex
CREATE INDEX "idx_users_status" ON "users"("status");

-- CreateIndex
CREATE INDEX "idx_refresh_tokens_user_id" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "idx_refresh_tokens_token_hash" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "idx_refresh_tokens_user_revoked" ON "refresh_tokens"("user_id", "is_revoked");

-- CreateIndex
CREATE INDEX "idx_refresh_tokens_expires_at" ON "refresh_tokens"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "roles_role_name_key" ON "roles"("role_name");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_types_type_name_key" ON "vehicle_types"("type_name");

-- CreateIndex
CREATE UNIQUE INDEX "floors_floor_name_key" ON "floors"("floor_name");

-- CreateIndex
CREATE INDEX "idx_floors_vehicle_type_id" ON "floors"("dedicated_vehicle_type_id");

-- CreateIndex
CREATE INDEX "idx_gates_floor_id" ON "gates"("floor_id");

-- CreateIndex
CREATE UNIQUE INDEX "parking_slots_slot_code_key" ON "parking_slots"("slot_code");

-- CreateIndex
CREATE INDEX "idx_parking_slots_floor_id" ON "parking_slots"("floor_id");

-- CreateIndex
CREATE INDEX "idx_parking_slots_vehicle_type_id" ON "parking_slots"("vehicle_type_id");

-- CreateIndex
CREATE INDEX "idx_parking_slots_assigned_user_id" ON "parking_slots"("assigned_user_id");

-- CreateIndex
CREATE INDEX "idx_parking_slots_status" ON "parking_slots"("status");

-- CreateIndex
CREATE INDEX "idx_pricing_policies_vehicle_type_id" ON "pricing_policies"("vehicle_type_id");

-- CreateIndex
CREATE INDEX "idx_subscription_packages_vehicle_type_id" ON "subscription_packages"("vehicle_type_id");

-- CreateIndex
CREATE INDEX "idx_monthly_subscriptions_user_id" ON "monthly_subscriptions"("user_id");

-- CreateIndex
CREATE INDEX "idx_monthly_subscriptions_license_plate" ON "monthly_subscriptions"("license_plate");

-- CreateIndex
CREATE INDEX "idx_monthly_subscriptions_status" ON "monthly_subscriptions"("status");

-- CreateIndex
CREATE INDEX "idx_subscription_renewals_subscription_id" ON "subscription_renewals"("subscription_id");

-- CreateIndex
CREATE INDEX "idx_vehicle_change_requests_subscription_id" ON "vehicle_change_requests"("subscription_id");

-- CreateIndex
CREATE INDEX "idx_vehicle_change_requests_handler_id" ON "vehicle_change_requests"("handled_by_staff_id");

-- CreateIndex
CREATE INDEX "idx_reservations_user_id" ON "reservations"("user_id");

-- CreateIndex
CREATE INDEX "idx_reservations_status" ON "reservations"("status");

-- CreateIndex
CREATE INDEX "idx_reservations_expected_entry_time" ON "reservations"("expected_entry_time");

-- CreateIndex
CREATE INDEX "idx_parking_sessions_driver_user_id" ON "parking_sessions"("driver_user_id");

-- CreateIndex
CREATE INDEX "idx_parking_sessions_license_plate_in" ON "parking_sessions"("license_plate_in");

-- CreateIndex
CREATE INDEX "idx_parking_sessions_status" ON "parking_sessions"("status");

-- CreateIndex
CREATE INDEX "idx_parking_sessions_reservation_id" ON "parking_sessions"("reservation_id");

-- CreateIndex
CREATE INDEX "idx_payments_user_id" ON "payments"("user_id");

-- CreateIndex
CREATE INDEX "idx_payments_session_id" ON "payments"("session_id");

-- CreateIndex
CREATE INDEX "idx_payments_reservation_id" ON "payments"("reservation_id");

-- CreateIndex
CREATE INDEX "idx_payments_subscription_id" ON "payments"("subscription_id");

-- CreateIndex
CREATE INDEX "idx_payments_transaction_reference" ON "payments"("transaction_reference");

-- CreateIndex
CREATE INDEX "idx_payments_payment_status" ON "payments"("payment_status");

-- CreateIndex
CREATE INDEX "idx_incident_reports_reporter_id" ON "incident_reports"("reported_by_user_id");

-- CreateIndex
CREATE INDEX "idx_incident_reports_handler_id" ON "incident_reports"("handled_by_staff_id");

-- CreateIndex
CREATE INDEX "idx_incident_reports_session_id" ON "incident_reports"("session_id");

-- CreateIndex
CREATE INDEX "idx_incident_reports_status" ON "incident_reports"("status");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_pbms_role_id_fkey" FOREIGN KEY ("pbms_role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "floors" ADD CONSTRAINT "floors_dedicated_vehicle_type_id_fkey" FOREIGN KEY ("dedicated_vehicle_type_id") REFERENCES "vehicle_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gates" ADD CONSTRAINT "gates_floor_id_fkey" FOREIGN KEY ("floor_id") REFERENCES "floors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_slots" ADD CONSTRAINT "parking_slots_floor_id_fkey" FOREIGN KEY ("floor_id") REFERENCES "floors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_slots" ADD CONSTRAINT "parking_slots_vehicle_type_id_fkey" FOREIGN KEY ("vehicle_type_id") REFERENCES "vehicle_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_slots" ADD CONSTRAINT "parking_slots_assigned_user_id_fkey" FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_policies" ADD CONSTRAINT "pricing_policies_vehicle_type_id_fkey" FOREIGN KEY ("vehicle_type_id") REFERENCES "vehicle_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_packages" ADD CONSTRAINT "subscription_packages_vehicle_type_id_fkey" FOREIGN KEY ("vehicle_type_id") REFERENCES "vehicle_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monthly_subscriptions" ADD CONSTRAINT "monthly_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monthly_subscriptions" ADD CONSTRAINT "monthly_subscriptions_vehicle_type_id_fkey" FOREIGN KEY ("vehicle_type_id") REFERENCES "vehicle_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monthly_subscriptions" ADD CONSTRAINT "monthly_subscriptions_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "subscription_packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monthly_subscriptions" ADD CONSTRAINT "monthly_subscriptions_fixed_slot_id_fkey" FOREIGN KEY ("fixed_slot_id") REFERENCES "parking_slots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_renewals" ADD CONSTRAINT "subscription_renewals_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "monthly_subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_change_requests" ADD CONSTRAINT "vehicle_change_requests_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "monthly_subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_change_requests" ADD CONSTRAINT "vehicle_change_requests_handled_by_staff_id_fkey" FOREIGN KEY ("handled_by_staff_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_vehicle_type_id_fkey" FOREIGN KEY ("vehicle_type_id") REFERENCES "vehicle_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_sessions" ADD CONSTRAINT "parking_sessions_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_sessions" ADD CONSTRAINT "parking_sessions_driver_user_id_fkey" FOREIGN KEY ("driver_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_sessions" ADD CONSTRAINT "parking_sessions_vehicle_type_id_fkey" FOREIGN KEY ("vehicle_type_id") REFERENCES "vehicle_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_sessions" ADD CONSTRAINT "parking_sessions_entry_gate_id_fkey" FOREIGN KEY ("entry_gate_id") REFERENCES "gates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_sessions" ADD CONSTRAINT "parking_sessions_exit_gate_id_fkey" FOREIGN KEY ("exit_gate_id") REFERENCES "gates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_sessions" ADD CONSTRAINT "parking_sessions_assigned_slot_id_fkey" FOREIGN KEY ("assigned_slot_id") REFERENCES "parking_slots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_sessions" ADD CONSTRAINT "parking_sessions_actual_slot_id_fkey" FOREIGN KEY ("actual_slot_id") REFERENCES "parking_slots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "parking_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "monthly_subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "parking_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_reported_by_user_id_fkey" FOREIGN KEY ("reported_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_handled_by_staff_id_fkey" FOREIGN KEY ("handled_by_staff_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Seed PBMS role names used by C# Authorize / AuthService.GetRoleByNameAsync("User")
INSERT INTO "roles" ("id", "role_name", "description") VALUES
  (gen_random_uuid(), 'User', 'Default PBMS user role'),
  (gen_random_uuid(), 'Customer', 'PBMS customer role alias'),
  (gen_random_uuid(), 'Staff', 'PBMS staff role'),
  (gen_random_uuid(), 'Manager', 'PBMS manager role'),
  (gen_random_uuid(), 'Admin', 'PBMS admin role')
ON CONFLICT ("role_name") DO NOTHING;
