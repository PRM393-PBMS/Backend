# Render Free và UptimeRobot monitor

URL công khai hiện dùng: `https://prm393-backend-u2ym.onrender.com`

## Sự thật về gói miễn phí

Web Service **Render Free** tắt process sau một khoảng thời gian không có traffic. Đây là hành vi nền tảng, không phải lỗi app.

- Lần request đầu sau khi ngủ là **cold start**: thường mất hàng chục giây (đôi khi lâu hơn) trước khi API trả lời.
- **Không thể hứa 24/7 miễn phí trên Render Free.** Ping chỉ giảm xác suất ngủ, không phải SLA.
- Muốn instance Render **không spin-down**: dùng gói trả phí (always-on). Repo này không thêm dịch vụ trả phí.

Không cấu hình self-ping trong cùng process trên Render: khi service đã ngủ thì code trong box đó không chạy.

## Endpoint để ping (rẻ, không đụng DB)

`GET /` công khai, redirect 302 sang `/api/docs` (nặng hơn vì Swagger).

Ping keep-alive nên dùng:

```text
GET https://prm393-backend-u2ym.onrender.com/health
```

Kỳ vọng: HTTP 200, JSON `{"status":"ok"}`, không cần JWT, không truy vấn PostgreSQL.

Health Check Path trên dashboard Render cũng nên là `/health` (xem `docs/render-health-check.md`). Health check của Render **không** thay thế cron bên ngoài khi instance đã spin-down.

## Monitor UptimeRobot đang dùng

### UptimeRobot

UptimeRobot được cấu hình làm HTTP(s) monitor cho `https://prm393-backend-u2ym.onrender.com/health`.

- Monitor Type: **HTTP(s)**.
- Friendly Name: `PRM393 backend health`.
- Interval: **5 phút** (hoặc theo giới hạn gói đang dùng).
- Expected response: HTTP 200.

Monitor chạy bên ngoài Render nên có thể đánh thức service khi nó đã spin-down. Kiểm tra trạng thái monitor và alert trên dashboard UptimeRobot; đây là monitor HTTP, không xác minh database Supabase hay gửi mail Resend.

### cron-job.org

1. Tạo tài khoản tại [cron-job.org](https://cron-job.org/).
2. **Create cronjob**.
3. Title: ví dụ `PRM393 /health`.
4. Address / URL: `https://prm393-backend-u2ym.onrender.com/health`.
5. Request method: **GET**.
6. Schedule: mỗi **5–10 phút**.
7. Lưu và bật job.

### GitHub Actions (tùy chọn, vẫn là ping từ ngoài)

Workflow `schedule` trên repo khác hoặc cùng repo, `curl` URL `/health` mỗi 5–10 phút. Vẫn chịu giới hạn lịch GitHub, ToS Render, và không phải bảo đảm 24/7.

## Giới hạn — đọc trước khi tin “luôn online”

- Render vẫn có thể ngủ, throttle, hoặc thay đổi chính sách **fair use / Terms of Service**. Ping dày đặc có thể bị coi là lạm dụng gói free.
- PostgreSQL chạy trên Supabase và có giới hạn/quy trình backup riêng, độc lập với web process Render.
- Cold start vẫn xảy ra nếu ping trễ, job lỗi, hoặc nền tảng spin-down dù có monitor.
- **Không phải cam kết 24/7.**

## Hướng miễn phí hơn nếu cần máy luôn bật

Oracle Cloud **Always Free** VM, hoặc VPS nhỏ tự quản: instance có thể chạy liên tục nhưng **tốn công vận hành** (SSH, firewall, Node, Postgres, HTTPS, backup). Không phải “bấm một cái rồi quên”.

Chi tiết deploy: `docs/huong-dan-env-va-deploy.md`.
