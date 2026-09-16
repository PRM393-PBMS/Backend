# Render Free: ngủ khi idle, không phải 24/7 miễn phí

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

## Cách miễn phí tạm thời: cron bên ngoài mỗi 5–10 phút

Chọn **một** dịch vụ bên ngoài (không chạy trên cùng box Render).

### UptimeRobot

1. Tạo tài khoản tại [UptimeRobot](https://uptimerobot.com/).
2. **Add New Monitor**.
3. Monitor Type: **HTTP(s)**.
4. Friendly Name: ví dụ `PRM393 backend health`.
5. URL: `https://prm393-backend-u2ym.onrender.com/health`.
6. Interval: **5 phút** (hoặc 10 phút nếu gói free giới hạn).
7. Tạo monitor, để chạy liên tục.

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
- PostgreSQL và addon khác trên Render Free có **hạn riêng** (ví dụ hết hạn / giới hạn kết nối), độc lập với web process.
- Cold start vẫn xảy ra nếu ping trễ, job lỗi, hoặc nền tảng spin-down dù có monitor.
- **Không phải cam kết 24/7.**

## Hướng miễn phí hơn nếu cần máy luôn bật

Oracle Cloud **Always Free** VM, hoặc VPS nhỏ tự quản: instance có thể chạy liên tục nhưng **tốn công vận hành** (SSH, firewall, Node, Postgres, HTTPS, backup). Không phải “bấm một cái rồi quên”.

Chi tiết deploy: `docs/huong-dan-env-va-deploy.md`.
