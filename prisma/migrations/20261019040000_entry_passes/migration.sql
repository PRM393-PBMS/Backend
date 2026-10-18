-- Mã QR gửi xe một lần
CREATE TABLE "entry_passes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "code" VARCHAR(12) NOT NULL,
    "status" VARCHAR(15) NOT NULL DEFAULT 'Active',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "used_at" TIMESTAMPTZ(6),
    "session_id" UUID,

    CONSTRAINT "entry_passes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "entry_passes_session_id_key" ON "entry_passes"("session_id");
CREATE INDEX "idx_entry_passes_user_created" ON "entry_passes"("user_id", "created_at" DESC);
CREATE INDEX "idx_entry_passes_vehicle_status" ON "entry_passes"("vehicle_id", "status");

ALTER TABLE "entry_passes" ADD CONSTRAINT "entry_passes_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "entry_passes" ADD CONSTRAINT "entry_passes_vehicle_id_fkey"
    FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "entry_passes" ADD CONSTRAINT "entry_passes_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "parking_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
