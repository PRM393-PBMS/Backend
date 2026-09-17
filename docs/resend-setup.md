# Gửi mail OTP bằng Resend

Backend gửi **mọi** email OTP (local và Render) qua [Resend Emails API](https://resend.com/docs/api-reference/emails/send-email) (HTTPS). Không còn SMTP.

API frontend **không đổi**: `POST /api/Auth/send-register-otp` và `POST /api/Auth/request-reset-password`.

Không dán API key vào chat, Git, `.env.example`, hay tài liệu.

## Domain brand: `neoforcelab.com`

Đã chốt domain **`neoforcelab.com`**. Domain này dùng cho:

- `From` OTP: `otp@neoforcelab.com`
- Sau này (tuỳ chọn): website `https://neoforcelab.com` hoặc `www`, API `api.neoforcelab.com` — **không bắt buộc** để OTP chạy

Email đăng nhập Resend **không** phải địa chỉ `From`.

### Đơn hàng nhà tên miền còn “chờ xử lý”

DNS chưa active thì **không** verify Resend được. OTP tới Gmail khách sẽ fail cho đến khi:

1. Nhà tên miền báo domain **đã kích hoạt** (có trang DNS).
2. Resend → **Domains** → Add `neoforcelab.com` (không `www`, không `https://`).
3. Copy **đúng** bản ghi Resend hiện (SPF, DKIM, …) vào DNS nhà tên miền. **Không** copy bản ghi mẫu từ tài liệu này.
4. Resend chuyển **Verified**.
5. Render + `.env` local: `MAIL_FROM` / `MAIL_REPLY_TO` như dưới (đã setup sẵn trong repo).

Trước khi Verified, có thể tạm `MAIL_FROM=onboarding@resend.dev` chỉ để test tới email tài khoản Resend. Production OTP dùng `otp@neoforcelab.com`.

## Biến môi trường

| Biến | Bắt buộc | Vai trò |
|---|---|---|
| `RESEND_API_KEY` | Có | Key API (key mới, không dùng key đã lộ). |
| `MAIL_FROM` | Có | `otp@neoforcelab.com` |
| `MAIL_SENDER_NAME` | Không | Trống → `NEO Force Lab`. |
| `MAIL_REPLY_TO` | Không | Mặc định trùng `MAIL_FROM`. |
| `MAIL_BRAND_COLOR` | Không | `#RRGGBB`. Trống → `#0F766E`. |

Đã gỡ SMTP: `MAIL_HOST`, `MAIL_PORT`, `MAIL_SECURE`, `MAIL_PASSWORD`, `MAIL_SENDER_EMAIL`.

### Local `.env` và Render

```dotenv
RESEND_API_KEY=
MAIL_FROM=otp@neoforcelab.com
MAIL_REPLY_TO=otp@neoforcelab.com
MAIL_SENDER_NAME="NEO Force Lab"
MAIL_BRAND_COLOR="#0F766E"
```

Render: điền `RESEND_API_KEY` trên dashboard; các `MAIL_*` như trên. Deploy bản code đã chuyển Resend.

## Key API đã lộ

Thu hồi key cũ trên Resend → API Keys, tạo key mới, chỉ điền `.env` local và Render.

## Webhook bounce / complaint (tuỳ chọn)

Chưa có endpoint trong app. Không cần để OTP đi. Sau này: webhook Resend khi muốn chặn hộp thư chết.

## Kiểm tra gửi

1. Domain **Verified** trên Resend.
2. `RESEND_API_KEY` mới + `MAIL_FROM=otp@neoforcelab.com`.
3. `POST /api/Auth/send-register-otp` tới hộp thư bạn kiểm soát.
4. Inbox/Spam. API 200 chưa đủ nếu domain chưa Verified (Resend trả lỗi From).
