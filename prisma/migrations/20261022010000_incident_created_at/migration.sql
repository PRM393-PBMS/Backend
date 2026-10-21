-- Thời điểm khách báo sự cố (trước đây không lưu, danh sách sắp theo uuid nên lộn xộn).
ALTER TABLE "incident_reports" ADD COLUMN "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Dữ liệu cũ không có giờ báo: sự cố đã xử lý lấy mốc xử lý làm cận trên.
UPDATE "incident_reports" SET "created_at" = "resolved_at" WHERE "resolved_at" IS NOT NULL AND "resolved_at" < "created_at";

CREATE INDEX "idx_incident_reports_reporter_created" ON "incident_reports"("reported_by_user_id", "created_at" DESC);
