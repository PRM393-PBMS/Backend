-- Lượt quét biển số từ điện thoại nhân viên ở cổng.
CREATE TABLE "gate_scans" (
    "id" UUID NOT NULL,
    "gate_id" UUID NOT NULL,
    "scanned_by_id" UUID NOT NULL,
    "image_url" VARCHAR(2048) NOT NULL,
    "license_plate" VARCHAR(15),
    "confidence" DOUBLE PRECISION,
    "captured_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "suggested_type" VARCHAR(15) NOT NULL,
    "reservation_id" UUID,
    "match" JSONB,
    "status" VARCHAR(15) NOT NULL DEFAULT 'New',
    "handled_at" TIMESTAMPTZ(6),

    CONSTRAINT "gate_scans_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_gate_scans_gate_created" ON "gate_scans"("gate_id", "created_at" DESC);

ALTER TABLE "gate_scans" ADD CONSTRAINT "gate_scans_gate_id_fkey" FOREIGN KEY ("gate_id") REFERENCES "gates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "gate_scans" ADD CONSTRAINT "gate_scans_scanned_by_id_fkey" FOREIGN KEY ("scanned_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
