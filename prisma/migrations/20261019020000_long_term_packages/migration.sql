-- Gói dài hạn 3, 6, 9, 12 tháng (kèm hợp đồng điện tử) cho mỗi loại xe đang có gói 1 tháng.
-- Giá mặc định = giá 1 tháng x số tháng, cùng yêu cầu ô cố định; quản lý chỉnh giá / ưu đãi sau.
-- Chỉ thêm kỳ hạn còn thiếu nên chạy lại không tạo trùng.
INSERT INTO "subscription_packages"
    ("id", "package_name", "vehicle_type_id", "duration_months", "duration_days",
     "price", "require_fixed_slot", "description", "status")
SELECT gen_random_uuid(),
       'Gói ' || m.months || ' tháng ' || lower(vt."type_name"),
       base."vehicle_type_id",
       m.months,
       m.months * 30,
       base."price" * m.months,
       base."require_fixed_slot",
       'Gói gửi xe ' || m.months || ' tháng, ký hợp đồng điện tử trước khi thanh toán',
       'Active'
FROM (
    SELECT DISTINCT ON ("vehicle_type_id") *
    FROM "subscription_packages"
    WHERE "duration_months" = 1 AND "status" = 'Active'
    ORDER BY "vehicle_type_id", "price"
) AS base
JOIN "vehicle_types" vt ON vt."id" = base."vehicle_type_id"
CROSS JOIN (VALUES (3), (6), (9), (12)) AS m(months)
WHERE NOT EXISTS (
    SELECT 1 FROM "subscription_packages" q
    WHERE q."vehicle_type_id" = base."vehicle_type_id" AND q."duration_months" = m.months
);
