-- Sơ đồ tầng do admin vẽ: bản xuất bản, bản nháp, số phiên bản.
ALTER TABLE "floors" ADD COLUMN "layout" JSONB;
ALTER TABLE "floors" ADD COLUMN "layout_draft" JSONB;
ALTER TABLE "floors" ADD COLUMN "layout_version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "floors" ADD COLUMN "layout_published_at" TIMESTAMPTZ(6);
