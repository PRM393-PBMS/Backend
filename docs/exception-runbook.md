# Hướng dẫn vận hành và đối soát exception PBMS

Kết quả cập nhật sau merge main và tích hợp Flutter ngày 05/11/2026 nằm ở [exception-status.md](exception-status.md). Lần kiểm tra cuối dùng DB local `pbms_main_merge_20261105_test` tại 127.0.0.1:55439; số liệu `pbms_exception_test` bên dưới thuộc vòng kiểm tra trước. Chưa deploy Supabase.

## Trước triển khai

1. Chọn đúng database development/staging; lưu backup và xác minh có thể khôi phục. Không chạy test trên database phục vụ người dùng.
2. Chạy `node --env-file=.env scripts/exception-preflight.mjs` với cấu hình của môi trường định triển khai. Script chỉ đọc và xuất nhóm bản ghi vi phạm; exit code 2 nghĩa là phải dừng, đối soát dữ liệu trước migration. Không xóa lịch sử để làm migration pass.
3. Đặc biệt kiểm tra: hai phiên mở cùng biển/ô; nhiều vé Active/PendingPayment cùng xe; nhiều EntryPass Active; orderCode PayOS trùng; giá/thời lượng/capacity âm hoặc quan hệ bãi–tầng–ô sai.
4. Migration `20261104000000` thêm appliedAt, reconciliationReason, snapshot gói gia hạn và bảng idempotency. Success lịch sử được gắn `LEGACY_REVIEW_REQUIRED`, không tự phát lại quyền lợi. Bảng idempotency bật RLS và không có policy public; chỉ backend DB role được truy cập.
5. Migration `20261104000100` thêm unique partial indexes và dừng nếu dữ liệu vi phạm. `20261104000200` bảo vệ write qua SQL triggers và check constraints (NOT VALID để không tự sửa lịch sử). Sau đối soát, người quản trị có thể VALIDATE các check constraints trong cửa sổ triển khai riêng.
6. Migration `20261104000300` sửa lệch baseline có sẵn: migration cũ tạo role SMALLINT trong khi schema hiện là UUID. Chỉ chuyển khi cột còn SMALLINT; dùng cùng ánh xạ xác định cho roles.id và users.role_id để giữ mọi quyền. Database đã dùng UUID không bị chuyển đổi. Kiểm tra lại user/role sau migrate.
7. Chạy `npx --no-install prisma migrate deploy`, `prisma generate`, build và smoke test. Không dùng migrate reset/db push. Migration SQL chạy transaction để lỗi không để lại schema một phần.
8. Triển khai backend sau schema. Khi rollback ứng dụng, giữ các cột bổ sung và lịch sử tài chính; không DROP TABLE/COLUMN hoặc bỏ constraint tự động. Cần audit tương thích trước khi chạy lại phiên bản ứng dụng cũ.

Đợt triển khai code này được kiểm chứng trên PostgreSQL local riêng trong `.tmp/exception-postgres`, port 55439, database `pbms_exception_test`. Chưa áp dụng lên Supabase phục vụ người dùng. Bản dữ liệu local chỉ chứa dữ liệu giả và có thể dừng bằng `pg_ctl -D <đường dẫn tuyệt đối tới .tmp/exception-postgres> stop`. Không sử dụng cụm trust-auth này cho deployment hoặc bind ra mạng ngoài.

## Thay đổi API cần thông báo cho client

- Nội dung `message` lỗi là lời nhắn tiếng Việt dành cho người dùng, có thể thay đổi để rõ hơn. Không dùng chuỗi message để quyết định retry/ownership/trạng thái tài chính; dùng HTTP và errorCode. `requestId` phục vụ tra log, không hiện stack/SQL/provider response hoặc bắt người dùng nhập token.
- Khi timeout thanh toán hoặc chờ đối soát, giữ hướng dẫn kiểm tra lịch sử/trạng thái và liên hệ hỗ trợ; không thay bằng thông báo chung khuyến khích thanh toán lại. Mã lỗi mới cần bổ sung vào `src/common/user-message.ts` và `Frontend/lib/core/error/user_message.dart` nếu cần cách phục hồi riêng. Thông báo chưa nhận biết có fallback an toàn.

- POST/PUT/DELETE trực tiếp `/api/payments` trả 409; dùng checkout, confirm-cash, sync, top-up hoặc đăng ký/gia hạn. Payment không bị xóa kể cả Pending để không mất khả năng khớp webhook về trễ.
- POST `/api/ParkingSession` đi qua check-in để chiếm ô và tạo phiên nguyên tử. PUT chỉ chỉnh dữ liệu ảnh; không sửa định danh/trạng thái/ô/thời gian vận hành. DELETE phiên bị chặn để giữ lịch sử.
- Thay trạng thái reservation thủ công chỉ cho hủy; check-in/thanh toán quản lý các trạng thái khác. Đổi giờ reservation bắt buộc ownership.
- Danh sách rỗng trả 200; số dư ví thiếu trả 402; body lỗi có mã và requestId bổ sung. Client vẫn phải kiểm tra HTTP/isSuccess.
- Registration OTP mới lưu password hash trong Redis; OTP đăng ký đang chờ từ phiên bản cũ có thể phải gửi lại sau rollout.

## Cấu hình và theo dõi

- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`: bắt buộc tối thiểu 32 ký tự, không dùng placeholder. Không còn fallback secret hard-code. Thay secret có thể làm token đang lưu mất hiệu lực; cần thông báo đăng nhập lại.
- `DATABASE_URL`, `REDIS_URL`, PayOS credentials/return URLs, Resend verified sender, OCR API key, upload volume và key hợp đồng phải được cấu hình đúng môi trường. Không ghi giá trị thật vào ticket/log.
- Giữ key ECDSA P-256 của hợp đồng trong secret store; sao lưu và giữ public key/key ID cũ khi luân chuyển. Không sinh key mới mỗi lần khởi động.
- `/health` xác nhận process sống. `/health/ready` xác nhận truy vấn DB và Redis; readiness lỗi trả 503. Sự cố khởi động vì DB/Redis/secret cần xem log startup.
- Timeout HTTP PayOS mặc định 10 giây, OCR 15 giây; GET retry tối đa 2 lần. POST tài chính không tự retry bằng orderCode mới. Email có giới hạn chờ 10 giây; timeout không chứng minh email chưa được gửi.
- Cron mỗi phút phục hồi payment Success chưa applied, đồng bộ PayOS Pending có orderCode, thu hồi reservation quá hạn và hết hạn vé tháng. Mỗi worker có kiểm tra trạng thái/khóa; thông báo chỉ gửi sau áp dụng. Quy mô lớn cần đo độ trễ cron và phân trang hàng chờ thay vì mặc định một lượt quét xử lý hết backlog.
- Quan sát tỷ lệ 5xx/409, payment Success chưa applied, tuổi Pending, reconciliation backlog, thời gian chờ khóa, số ô Occupied khác số phiên mở và log `BackendException` theo requestId.

## Giao dịch không rõ kết quả

Khách thấy timeout sau POST không có nghĩa giao dịch thất bại. Giữ cùng Idempotency-Key cho cùng ý định/payload. Kiểm tra lịch sử resource, payment sync hoặc exit-pass trước khi gửi lại. Key chưa có response trả OPERATION_PENDING; không tự xóa key đó hoặc chuyển key để né.

OrderCode được lưu trước khi gọi PayOS. Nếu mất response, lookup order đã lưu. Chỉ có kết quả xác định không tồn tại mới tạo lại chính orderCode đó. Nếu nhà cung cấp hoặc mạng chưa trả lời, giữ Pending và yêu cầu kiểm tra trạng thái. Không đánh dấu Failed chỉ vì HTTP timeout.

Khi chuyển PayOS sang ví, phải xác minh/hủy PayOS xong trước khi debit ví. Nếu PayOS đã PAID, đồng bộ khoản đó thay vì trả lần nữa. Nếu cả hai kênh đã thu do cuộc đua với ngân hàng, lưu đủ chứng từ và đưa phần thu trùng vào đối soát; không tự hoàn ví/tiền ngân hàng.

## Quy trình đối soát

`GET /api/payments/reconciliation` yêu cầu JWT manager, trả tối đa 200 bản ghi cũ nhất gồm paymentId, thông tin giao dịch, appliedAt và reconciliationReason. Endpoint chỉ đọc, không tự hoàn tiền.

| Mã / tình trạng                                   | Kiểm tra bắt buộc                                                                    | Xử lý vận hành                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| LEGACY_REVIEW_REQUIRED                            | Chứng từ ngân hàng/PayOS, ledger ví, ngày vé/renewal, trạng thái session/reservation | Chỉ đánh dấu đã áp dụng khi có bằng chứng; nếu chưa đủ thì giữ nguyên và liên hệ chủ nghiệp vụ |
| AMOUNT_MISMATCH                                   | orderCode, số tiền dự kiến, amountPaid và khoản thực nhận                            | Ghi thiếu/thừa, xác định nghĩa vụ còn lại; không tự cấp quyền toàn phần                        |
| LATE_DEPOSIT                                      | Đơn đã Cancelled/NoShow/Completed trước lúc tiền về                                  | Không phục hồi đơn; quản lý quyết định hoàn/giữ tiền theo chính sách                           |
| DUPLICATE_PREPAY / DUPLICATE_DEPOSIT              | Tất cả payment và channel cho cùng session/reservation                               | Xác nhận quyền đã được cấp một lần; đối soát khoản dư                                          |
| FIXED_SLOT_UNAVAILABLE / SUBSCRIPTION_NOT_PENDING | Vé đã nhận tiền, scope bãi, tình trạng ô và hợp đồng                                 | Cấp ô thay thế hoặc hoàn theo quyết định có thẩm quyền; không ghi đè ô người khác              |
| Success, appliedAt null, reason null              | Log requestId và lỗi DB ở bước áp dụng                                               | Sửa nguyên nhân; cron/sync có thể áp dụng lại an toàn theo payment lock                        |
| OPERATION_PENDING                                 | Idempotency record, resource và provider order tương ứng                             | Xác minh giao dịch trước khi mở lại quyền gửi; không xóa claim tùy tiện                        |

Lưu hồ sơ đối soát gồm người xử lý, thời gian, ID chứng từ, quyết định và kết quả. Thao tác hiệu chỉnh dữ liệu là quy trình quản trị riêng, không sửa trực tiếp balance/Success/appliedAt theo phỏng đoán. Backend chưa cung cấp API tự hoàn tiền hoặc API xác nhận đối soát thủ công.

## Ra bãi sau thanh toán trước

Exit pass hợp lệ ở đúng 15 phút kể từ quyết toán; sau mốc đó `isExpired=true`. Tổng tiền cần thu bổ sung là tổng phí hiện tại trừ tiền cọc và các phí gửi xe đã nhận, tối thiểu 0. Không trừ top-up ví hoặc giá mua vé tháng như khoản thanh toán phí phiên. Khoản đang đối soát chặn thu bổ sung cho tới khi xác minh.

Khi bổ sung đủ tiền/quyết toán số dư 0, cấp lại mã và cửa sổ 15 phút. Backend kiểm tra lại ở cổng kể cả khi frontend hiển thị mã cũ hoặc khách dùng biển số. Nhân viên không được đổi giờ ra/entryTime để né tính phí.

## Các tình huống không thể tự sửa hoàn toàn bằng backend

| Tình huống                             | Dấu hiệu và giới hạn                                                         | Chủ xử lý / thao tác                                                                                                       |
| -------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Frontend redirect lặp                  | Route sai nối `/dang-nhap`; backend không kiểm soát React Router             | Frontend: route tuyệt đối, error route                                                                                     |
| Frontend role lạ / hồ sơ hỏng          | Trang trắng, JSON.parse localStorage lỗi                                     | Frontend: kiểm tra role, try/catch và xóa cache hỏng                                                                       |
| Frontend thiếu Error Boundary          | Lỗi render làm mất toàn bộ UI                                                | Frontend: boundary có tải lại/reset khi đổi route                                                                          |
| Frontend null/mảng và lỗi bị nuốt      | `.map/filter/find` lỗi hoặc hiển thị nhầm bãi trống                          | Frontend: kiểm tra shape, phân biệt lỗi API với danh sách rỗng                                                             |
| Frontend message/refresh/UX thanh toán | Hiện tiếng Anh kỹ thuật, refresh nhiều lần, form cọc lại sau tải vé thất bại | Frontend: dùng message/errorCode, refresh queue; xác nhận giao dịch qua lịch sử trước retry                                |
| Render cold start hoặc máy chủ dừng    | Request đầu timeout; không thể bảo đảm server luôn thức bằng catch           | Vận hành: chọn gói hosting/healthcheck; frontend thông báo và không tự retry POST với key mới                              |
| PayOS/ngân hàng outage                 | 502/504, Pending kéo dài, webhook trễ                                        | Provider/vận hành: tra dashboard và chứng từ; phục hồi callback/network; dùng sync sau khi dịch vụ trở lại                 |
| Mất tiền thực/thu trùng/hoàn tiền      | DB không chứng minh đủ khoản thực nhận                                       | Quản lý và ngân hàng: đối soát, duyệt hoàn; backend giữ chứng từ và không hoàn tự động                                     |
| Supabase/DB/Redis outage hoặc quota    | Readiness 503, pool timeout, credentials/TLS sai                             | Vận hành: sửa kết nối, quota, pool, chứng chỉ; không reset DB                                                              |
| DB/Redis mất dữ liệu                   | Không tìm thấy session/OTP/ledger                                            | Vận hành: restore backup/PITR; OTP mất phải gửi lại, không thể khôi phục từ hash                                           |
| Email không đến/spam                   | Resend nhận request nhưng người dùng không nhận                              | Mail/domain admin: verified sender, SPF/DKIM/DMARC, quota, suppression, bounce và hộp thư spam                             |
| Camera mờ/mất điện/barie hỏng          | OCR không có kết quả hoặc API thành công nhưng xe không qua cổng             | Nhân viên/thiết bị: nhập tay, QR/mã ngắn; kiểm tra controller, điện, camera. Backend hiện không điều khiển phần cứng barie |
| OCR nhận nhầm biển                     | Biển sai nhưng confidence cao vẫn có thể xảy ra                              | Nhân viên xác nhận qua ảnh/xe; cải thiện ánh sáng/camera; không thể bảo đảm OCR tuyệt đối                                  |
| Ảnh mất sau redeploy/disk đầy          | URL 404, upload 503                                                          | Vận hành: persistent volume/object storage, quota, backup. Không thể tái tạo ảnh gốc đã mất                                |
| Key hợp đồng mất/đổi                   | Không verify được seal cũ                                                    | Quản lý key: giữ key/public key lịch sử, phục hồi backup; không thể tái tạo chữ ký cũ khi mất key                          |
| Pháp lý hợp đồng và chính sách hoàn    | Tranh chấp chứng cứ, quyền ký hoặc lý do giữ cọc                             | Chủ nghiệp vụ/tư vấn pháp lý; chữ ký kỹ thuật không tự chứng minh giá trị pháp lý                                          |
| Biển số giả/đổi chủ/chiếm ô ngoài đời  | Dữ liệu API không khớp hiện trường                                           | Nhân viên và camera: kiểm tra người/xe; lập incident và giữ lịch sử                                                        |
| DNS/TLS hoặc đồng hồ host lệch         | Fetch lỗi, JWT/expiry sai                                                    | Vận hành: DNS, chứng chỉ, NTP; thời gian lưu UTC, hiển thị giờ Việt Nam                                                    |
| Thiếu quyền thao tác hosting/provider  | Không thể mở quota, cấu hình callback hoặc hoàn tiền                         | Chủ tài khoản/admin của dịch vụ; không có bản sửa code thay thế quyền này                                                  |

## Kết quả kiểm chứng ngày 05/11/2026

- Unit/HTTP/PostgreSQL: 25 suite, 123 test pass; trong đó 14 test chạy trên PostgreSQL 16 local riêng.
- HTTP e2e: 4/4 pass. Cả hai lần nghiệm thu dùng `--detectOpenHandles`, tự thoát và không dùng `--forceExit`.
- TypeScript toàn bộ source/test, oxlint và `npm run build` pass. Preflight dữ liệu test: 0 vi phạm.
- Cả 24 migration trong repository áp dụng được trên database test mới. Không áp dụng lên Supabase; cụm test đã được dừng, dữ liệu giả giữ trong `.tmp/exception-postgres`.
- PayOS/OCR/Resend được mock trong test; HMAC webhook được kiểm tra độc lập. Chưa nghiệm thu với provider thật, Redis thật, frontend hoặc thiết bị.

## Kiểm chứng và giới hạn triển khai

Chạy unit: `npm test -- --runInBand --detectOpenHandles`. Chạy HTTP e2e: `npm run test:e2e -- --runInBand --detectOpenHandles`. Cả hai dùng Node ESM flags thống nhất, không dùng forceExit để che leak.

Để chạy PostgreSQL tests, cấp `TEST_DATABASE_URL` local với tên database kết thúc `_test`, migrate vào chính database đó trước, rồi chạy `npm test -- --runInBand test/exception.integration.spec.ts`. Nếu thiếu biến này thì suite được skip rõ ràng; không lấy DATABASE_URL/Supabase làm fallback. Test tạo dữ liệu giả với ID/biển ngẫu nhiên và giữ trong database test để điều tra.

Các dịch vụ PayOS, OCR, Resend và Redis thật, cấu hình Supabase production, thiết bị và frontend cần acceptance test riêng với chủ môi trường. Không đánh dấu các mục ngoài backend là đã sửa chỉ vì API có catch. Tham chiếu [ma trận exception](exception-matrix.md) khi bàn giao.
