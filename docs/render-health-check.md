# Render: mở Swagger và cấu hình health check

Sau khi deploy phiên bản có thay đổi này:

- `GET /` công khai, trả redirect 302 sang `/api/docs`.
- `GET /api/docs` mở Swagger như trước.
- `GET /health` công khai, trả HTTP 200 với `{"status":"ok"}`.
- Các route nghiệp vụ vẫn chịu JWT guard; không thêm `@Public()` trên toàn controller nghiệp vụ.

## Áp dụng cho Web Service hiện có

1. Commit/push thay đổi code lên branch mà Render đang deploy.
2. Đợi auto-deploy hoặc chọn **Manual Deploy → Deploy latest commit**.
3. Trong Render Dashboard, mở đúng **Web Service backend**, vào Settings và tìm **Health Check Path**.
4. Đặt giá trị `/health`, lưu cấu hình và kiểm tra deployment thành công.
5. Mở URL gốc của backend: trình duyệt sẽ đến Swagger. Gọi `/health` không cần Bearer token.

Health này kiểm tra tiến trình HTTP còn phục vụ được request (liveness), không truy vấn PostgreSQL hoặc dịch vụ thanh toán. Để kiểm chứng database, đăng nhập và gọi API đọc dữ liệu thực. Không coi response health 200 là chứng nhận mọi dependency hoạt động.

Thay đổi file trong repo chưa tự sửa Settings trên Render của service đã tạo thủ công. Cần thực hiện bước 3–4 trên dashboard; không cần tạo lại database hay thay DATABASE_URL.

Tài liệu nền tảng: https://render.com/docs/health-checks
