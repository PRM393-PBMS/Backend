-- Tên khách tự đặt cho xe (vd. "Xe của mẹ") và mẫu xe (vd. "Toyota Vios 2020")
ALTER TABLE "vehicles" ADD COLUMN "nickname" VARCHAR(40);
ALTER TABLE "vehicles" ADD COLUMN "model_name" VARCHAR(60);
