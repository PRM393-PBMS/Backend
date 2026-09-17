# Ghi chú third-party & phần cần bạn can thiệp

Tài liệu nội bộ (tech lead) cho backend PBMS Node (NestJS). Nội bộ: Nest + Prisma + PostgreSQL.

Nguồn đối chiếu: clone `../SWP391_BackEnd` (backend gốc). Hợp đồng client: input/output HTTP theo freeze.

Path `/api/*` đã đóng băng: [`openapi-pbms-paths.md`](./openapi-pbms-paths.md). Prisma: [`prisma-draft-review.md`](./prisma-draft-review.md).

---

## Quyết định đã ghi nhận (từ bạn)

| # | Quyết định |
|---|------------|
| Phạm vi | Clone **toàn bộ** chức năng PBMS. Input/output phía client giống PBMS. |
| Path | Surface PBMS **bắt buộc** trùng path PBMS, kể cả casing: `/api/Auth/login`, `/api/ParkingOperation/check-in`, `/api/payments/payos-webhook`, … Nest **không** dùng global prefix `/api`; từng controller khai báo path đầy đủ. |
| Dual surface | **Đã gỡ** Nest `/auth/*`. Chỉ còn `/api/*` theo hợp đồng freeze. Stack chỉ Node/Nest. |
| Header | `Authorization: Bearer <access token>`. |
| JWT | Nội bộ theo Nest (an toàn hơn PBMS). Token dùng trên `/api/*` vẫn phải mang claim PBMS cần đọc. **Không** copy secret JWT hardcoded từ PBMS vào repo. Chi tiết mục dưới. |
| Vendor | **Theo repo PBMS** (PayOS, Gmail SMTP, PlateRecognizer, file local, PDF, job nền, QR). |
| Dữ liệu | **Không** dump SQL Server. Schema Postgres trống + seed role. Local và Render dùng Supabase **Session Pooler** `DATABASE_URL` với `sslmode=require`. |
| Env còn lại | Theo PBMS: CORS `http://localhost:5173`, PDF binary export, job NoShow + overdue reservations, static files, webhook PayOS path. |

---

## JWT: khuyến nghị đã chọn

**PBMS hiện tại (không bắt chước nội bộ):** một secret HMAC hardcoded, refresh JWT lưu **plaintext** trên bảng `RefreshTokens`, refresh **không** rotate, không `logout-all`.

**Nest sẽ dùng nội bộ:**

- Hai secret env: `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` (placeholder, tự sinh — **không** lấy từ `JwtSettingModel` PBMS).
- Access ngắn hạn; refresh hash (bcrypt) + rotation + `logout-all` như `src/auth` hiện có.
- Token **cho route `/api/*`** vẫn chứa claim mà code PBMS đọc, để I/O và phân quyền không gãy:
  - Bắt buộc: `UserId` (`ReservationController`, `ClaimsPrincipalExtensions.GetUserId`).
  - Cần cho role/I/O: `role` (tên role string như PBMS), `Email`, `UserName`, `RoleId`.
  - Được **thêm** `sub` / `email` / `role` (enum Nest) để guard Nest tái sử dụng được nếu cùng token.
- Token **cho `/api/*`** mang claim PBMS (`UserId`, `role` = `Role.roleName`, …) cùng `sub` / `email` để guard Nest tái sử dụng.

Client `/api/Auth/login` **vẫn** nhận JSON envelope PBMS (`statusCode`, `message`, `isSuccess`, `result.user` + `accessToken` + `refreshToken`). Khác biệt chỉ nằm **trong** JWT (issuer/secret/thời hạn/hash RT), không nằm ở field JSON login.

---

## Bề mặt HTTP công khai

| | PBMS |
|---|------|
| Path | `/api/Auth/...`, `/api/reservations`, `/api/ParkingOperation/...`, `/api/payments/payos-webhook`, `/api/profile`, … **đúng casing PBMS** |
| Body / status | Envelope `ResponseDTO` + field PBMS (`userName`, `fullName`, `refreshTokenKey`, …) |
| Token | Payload có `UserId` (+ claim PBMS khác) |
| Swagger | `/api/docs`; tag đăng nhập là **PBMS Auth** |

`GET /` chuyển tới Swagger, không phải hợp đồng PBMS.

---

## Keep vs replace — lần này **keep (tương đương Node)**

Quyết định hiện tại: **theo vendor PBMS**. Cột “nếu sau này thay” chỉ để bạn biết rủi ro; **chưa thay**.

| Vendor PBMS | Giữ (Node) thì sao | Thay sau này thì sao | Rủi ro phá hợp đồng client |
|-----------|--------------------|----------------------|----------------------------|
| **PayOS** (`BLL/Implements/PayOSService.cs`, webhook `POST /api/payments/payos-webhook`) | Client vẫn nhận `paymentUrl`, `paymentLinkId`, `orderCode`, QR checkout; webhook body `PayOSWebhookDTO` (`code`, `desc`, `data.orderCode`, …). Thành công webhook: **200 body rỗng**. | Cổng khác (VNPay/MoMo/…) | **Cao.** Field `paymentUrl` / `orderCode` / shape webhook PayOS sẽ lệch trừ khi viết **adapter giả PayOS** (JSON y hệt). Return/Cancel URL frontend 5173 cũng gắn PayOS. |
| **Gmail SMTP + MailKit** (`EmailService`, OTP đăng ký/reset) | OTP vẫn gửi email; API OTP JSON không đổi. | SES/SendGrid/Mailgun | **Thấp với JSON** nếu nội dung OTP cùng luồng. **Trung bình** nếu delay/spam/template khác làm client timeout OTP 10 phút. |
| **PlateRecognizer** (`PlateRecognizerService`) | `PlateRecognitionResultDTO` gồm `provider: "PlateRecognizer"`, `candidates`, `confidence`, HTTP 200/422. | OCR khác hoặc nhập tay | **Cao** nếu đổi `provider` hoặc bớt field. **Trung bình** nếu chỉ đổi backend OCR nhưng **giữ nguyên JSON**. |
| **wwwroot static files** (ảnh check-in, proof, QR upload) | URL tương đối kiểu file tĩnh; multipart giống PBMS. | S3/Cloudinary | **Trung bình.** Client đang nhận `imageUrl`. Đổi host/path CDN làm ảnh cũ gãy trừ khi giữ path public tương đương. |
| **QuestPDF** (`ReportService.ExportAsync` → `File(...)`) | `GET /api/reports/export` trả **binary PDF** + Content-Type/filename. | Excel/JSON only | **Cao** nếu không còn PDF. Format bytes có thể khác QuestPDF nhưng **vẫn phải là file PDF**. |
| **Hangfire** (cron mỗi phút overdue + delay NoShow `ExpectedEntryTime+30p`) | Hành vi nghiệp vụ giống: đơn quá hạn → NoShow. | Cron OS / queue khác | **Thấp với JSON** nếu kết quả reservation/status giống. **Cao** nếu bỏ job → trạng thái lệch client. |
| **QRCoder + ZXing** | Vé đặt chỗ có `qrPayload` + `qrCodeDataUrl`; decode ảnh QR check-in. | Lib Node khác | **Thấp** nếu payload/string QR **giống PBMS** (client quét được). **Cao** nếu đổi format payload. |

Webhook PayOS: **I/O bắt buộc giữ** dù implement Node. Không đổi path, không bọc `ResponseDTO` khi thành công, không đổi field `PayOSWebhookDTO` / `PayOSWebhookData`.

---

## Sẽ làm trên Node

`package.json`: Nest 12, JWT, Passport, bcrypt, class-validator, Swagger, Prisma 6.4.1, **nodemailer** (OTP). PayOS/OCR/PDF chưa cài.

Đề xuất khi implement (ghi chú, chưa `npm install`):

| Nhu cầu PBMS | Hướng Node (đề xuất) |
|------------|----------------------|
| Config sections `PayOS`, `MailSettings`, `PlateRecognizer` | `@nestjs/config` + env (skill: đọc theo tên biến, ghi `.env.example`) |
| PayOS SDK PBMS `payOS` 2.1.0 | REST PayOS hoặc SDK Node chính thức **khi** chốt version tương thích Nest 12 — chưa cài |
| MailKit SMTP | `nodemailer` (hoặc wrapper Nest mail) |
| HttpClient PlateRecognizer | `fetch` / axios — endpoint public, key từ env |
| Hangfire SQL | Job: `@nestjs/schedule` (cron overdue) + hàng đợi delay NoShow (`@nestjs/bullmq` **chỉ khi** cron không đủ delayed job). Chưa chọn package cuối. |
| QRCoder | `qrcode` (PNG data URL) |
| ZXing + ImageSharp | `jsqr` / `zxing-wasm` + `sharp` |
| QuestPDF | `pdfkit` / `pdfmake` (xuất binary, không cần pixel-identical với QuestPDF) |
| `UseStaticFiles` + wwwroot | `NestExpressApplication.useStaticAssets` + thư mục `uploads/` / `public/` |
| CORS 5173 | `enableCors({ origin: process.env.CORS_ORIGIN })` |

Không thêm TypeORM, không thêm queue chỉ vì rule generic — chỉ khi job NoShow cần.

---

## Bạn cần cung cấp (placeholder — không dán secret PBMS vào chat/repo)

Secret trong `SWP391_BackEnd/PBMS/appsettings.json` **đã nằm trên GitHub**. Hãy **xoay (rotate)** PayOS / Gmail App Password / PlateRecognizer / SQL `sa` trước khi dùng cho PRM. **Không** copy giá trị đó vào Nest.

| Hạng mục | Bạn gửi gì | Ghi chú |
|----------|------------|---------|
| PostgreSQL | Supabase Session Pooler URL cho local và Render. | Không commit URL/password; copy connection string từ Supabase Dashboard → Connect. |
| Dump SQL Server | **Không yêu cầu** | Schema trống trên Postgres; không dump data PBMS. |
| PayOS | ClientId, ApiKey, ChecksumKey, ReturnUrl, CancelUrl | Return/Cancel PBMS đang trỏ `http://localhost:5173/payment-success` và `payment-cancel` — xác nhận có giữ cho PRM không. |
| SMTP | Host, Port, SenderName, SenderEmail, Password (app password) | PBMS dùng `smtp.gmail.com:587`. |
| PlateRecognizer | ApiKey; Endpoint/Regions/MinimumConfidence nếu khác mặc định PBMS | Endpoint PBMS: `https://api.platerecognizer.com/v1/plate-reader/`, Regions `vn`, threshold `0.75`. |
| Webhook public | URL HTTPS PayOS gọi được tới Nest | Localhost không nhận webhook thật — cần tunnel (ngrok, …) do **bạn** tạo. Path giữ `/api/payments/payos-webhook`. |
| CORS thêm | Origin ngoài `http://localhost:5173` (mobile, domain deploy) | Mặc định theo PBMS: chỉ 5173. |
| JWT | Tự sinh hai secret mạnh cho `.env` local | Không dùng secret hardcoded PBMS. |

---

## Tên biến env (sẽ thêm vào `.env.example` khi implement)

Giữ các key đã có: `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `PORT`, `NODE_ENV`.

Dự kiến thêm (giá trị trống / placeholder, **không** secret PBMS):

```
CORS_ORIGIN=http://localhost:5173

PAYOS_CLIENT_ID=
PAYOS_API_KEY=
PAYOS_CHECKSUM_KEY=
PAYOS_RETURN_URL=http://localhost:5173/payment-success
PAYOS_CANCEL_URL=http://localhost:5173/payment-cancel

MAIL_HOST=smtp.gmail.com
MAIL_PORT=587
MAIL_SENDER_NAME=
MAIL_SENDER_EMAIL=
MAIL_PASSWORD=

PLATE_RECOGNIZER_API_KEY=
PLATE_RECOGNIZER_ENDPOINT=https://api.platerecognizer.com/v1/plate-reader/
PLATE_RECOGNIZER_REGIONS=vn
PLATE_RECOGNIZER_MINIMUM_CONFIDENCE=0.75

UPLOAD_DIR=./public/uploads
```

`JWT_ISSUER` / `JWT_AUDIENCE` **không** bắt buộc cho client JSON; PBMS có issuer/audience trong token. Nếu client **decode** JWT phía app: cần bạn xác nhận sau. Hiện I/O JSON login không lộ issuer.

---

## Entity PBMS → Prisma (chỉ danh sách, chưa viết schema)

Map UUID / snake_case trong `prisma/schema.prisma`. Migration `20260917032600_pbms_domain`.

| Entity PBMS (`DAL/Models`) | Ghi chú |
|--------------------------|---------|
| User | Thêm userName, phone, fullName, status string, roleId; Nest đang email + first/last + enum |
| Role | Bảng động (User, Customer, Staff, Manager, Admin — seed theo data PBMS) |
| RefreshToken | Hash + expiry + revoke (Nest); `/api` login JSON vẫn trả raw RT một lần |
| VehicleType | |
| Floor | |
| Gate | |
| ParkingSlot | |
| PricingPolicy | |
| SubscriptionPackage | |
| MonthlySubscription | |
| SubscriptionRenewal | |
| VehicleChangeRequest | |
| Reservation | |
| ParkingSession | |
| Payment | |
| IncidentReport | |

---

## Đang chặn

Không còn chờ dump SQL Server. OTP cần `MAIL_SENDER_EMAIL` + `MAIL_PASSWORD` trên máy chạy Nest. PayOS/OCR cần credential env; thiếu thì fail lúc gọi API, không giả lập thanh toán.

---

## Việc tiếp theo

1. Surface HTTP công khai chỉ `/api/*` theo hợp đồng freeze.  
2. Module bãi đỗ / reservation / PayOS / OCR / báo cáo đã gắn path `/api/...`.
