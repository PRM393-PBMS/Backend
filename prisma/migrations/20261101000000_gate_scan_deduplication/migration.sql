-- Existing scans have no key; PostgreSQL allows multiple NULL values in this index.
ALTER TABLE "gate_scans" ADD COLUMN "deduplication_key" VARCHAR(64);
CREATE UNIQUE INDEX "gate_scans_deduplication_key_key" ON "gate_scans"("deduplication_key");
