-- Sổ quỹ tiền mặt: ai thu, thu ở cổng nào, đã nộp quản lý chưa.
ALTER TABLE "payments" ADD COLUMN "collected_by_id" UUID;
ALTER TABLE "payments" ADD COLUMN "collected_gate_id" UUID;
ALTER TABLE "payments" ADD COLUMN "cash_handover_id" UUID;

CREATE TABLE "cash_handovers" (
    "id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "payment_count" INTEGER NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'Submitted',
    "note" VARCHAR(500),
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "review_note" VARCHAR(500),
    CONSTRAINT "cash_handovers_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "idx_cash_handovers_staff_status" ON "cash_handovers"("staff_id", "status");
CREATE INDEX "idx_cash_handovers_submitted_at" ON "cash_handovers"("submitted_at");
CREATE INDEX "idx_payments_cash_holding" ON "payments"("collected_by_id", "cash_handover_id");

ALTER TABLE "payments" ADD CONSTRAINT "payments_cash_handover_id_fkey"
    FOREIGN KEY ("cash_handover_id") REFERENCES "cash_handovers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
