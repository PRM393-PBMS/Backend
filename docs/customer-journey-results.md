# Kết quả kiểm tra logic theo hành trình

## Môi trường và bằng chứng

Ngày 05/11/2026, kiểm tra backend sau khi hợp nhất main `da84263`. Chuỗi HTTP chạy qua AppModule, controller, JWT/guard, validation, idempotency và PostgreSQL local `pbms_main_merge_20261105_test`. PayOS, email và OTP storage dùng adapter giả có thể điều khiển; không kiểm chứng mạng/ngân hàng/Redis/Resend thật và không chạy trên Supabase production.

`test/customer-journey.integration.spec.ts`: **15 nhánh pass** trong lần chạy cuối, gồm 8 hành trình chính, giữ chỗ quá hạn trước cron, đổi phạm vi gói khi gia hạn ví, thiếu ví rồi nạp lại, hai worker tự gia hạn đồng thời, OTP đăng ký/gửi lại/reset, ký hợp đồng trước PayOS và tạo lại cọc đồng thời sau khi order trước bị hủy.

## Các điểm đứt đã xác nhận và sửa

- **Cọc quá hạn nhưng cron chưa chạy:** sync/webhook từng có thể xác nhận Pending quá 15 phút giữ chỗ. Bước áp dụng nay kiểm tra thời hạn trực tiếp; tiền đã nhận được ghi chờ đối soát, không khôi phục đơn.
- **Tạo lại cọc cạnh tranh:** khóa reservation và kiểm tra payment bên trong transaction, tái dùng Pending thay vì tạo hai nghĩa vụ. Provider được gọi sau transaction. Hai request HTTP sau order Cancelled chỉ có một payment Pending mới.
- **Gia hạn ví khác quy tắc PayOS:** ví từng bỏ qua phạm vi bãi. Nay cả hai kênh giữ cùng phạm vi, kiểm tra lại trạng thái/owner dưới khóa và điều kiện hợp đồng.
- **Gia hạn cạnh tranh:** hai cron worker cùng đọc một vé sắp hết hạn có thể thu hai kỳ. Nay so sánh lại endDate, autoRenew và hạn đến dưới khóa; worker sau bỏ qua khi kỳ đã đổi. Có test PostgreSQL thật.
- **Vé hết hạn/đổi gói:** đường ví dùng chung activation để kiểm tra và claim ô trước gia hạn, cập nhật đúng gói/giá. Toàn bộ debit/payment/ledger/quyền lợi rollback nếu không claim được.
- **Đổi PayOS sang ví khi gia hạn:** phải tra và xác nhận hủy order trước debit, chặn khi đã thu hoặc chưa rõ kết quả; kiểm tra lại pending order dưới khóa. Không thực hiện network trong transaction khóa.
- **Tiền nhận khác quyền đã cấp:** API và Flutter có `applicationStatus`, `isApplied`, `appliedAt`. Sync đọc lại payment sau dispatch; lịch sử và polling không coi Success đơn thuần là đã cấp quyền. Trang trả về PayOS không khẳng định chưa trừ tiền khi không có chứng cứ.
- **Màn tiền mặt không tự hoàn tất:** trước đó chỉ poll khi có OnlinePayment và API chỉ tìm Pending. Nay poll cả tiền mặt và tiếp tục đọc được khoản Success sau staff xác nhận; không gọi lại PayOS cho khoản đã xong.
- **Cache giữa tài khoản:** phiên offline được lưu theo owner, bỏ phản hồi cũ khi user đổi và xóa cache khi phiên không còn active. Ví memo hóa kèm owner. Không dùng cache tài khoản trước cho tài khoản mới.
- **Deep link báo thành công giả:** không tin status trong query để kết luận tiền; reload dữ liệu backend và hiển thị đang kiểm tra.
- **OTP đăng ký gửi lại không làm gì:** bổ sung endpoint `POST /api/Auth/resend-register-otp` đọc hồ sơ đăng ký còn hiệu lực từ Redis, không gửi lại mật khẩu. Frontend gọi thật, chặn gửi khi loading/chờ và giữ thời gian chờ từ API.
- **Cờ auth tồn tại sang thao tác sau:** reset các cờ OTP/đăng ký/reset trước thao tác mới, tránh success của đăng ký điều hướng nhầm khi đổi sang quên mật khẩu.
- **Mã ra và widget:** mã hết hạn bị ẩn trong app; widget không in credential tĩnh có thể tồn tại sau hạn. Widget vẫn mở màn kiểm tra mã trong app.
- **Pagination:** giữ generation guard khi đổi filter, loại dòng trùng khi dữ liệu mới chen vào trang; backend sắp xếp theo thời gian và id. Không có lỗi API bị giả thành trang rỗng.
- **Route không tồn tại:** có đường quay về màn chính; OTP mở trực tiếp vẫn có đường trở về đăng ký/quên mật khẩu.

## Chưa được coi là hoàn tất chỉ bằng API tests

- OTP adapter không thay cho concurrency/TTL/throttle của Redis thật hoặc việc email thực sự đến hộp thư.
- PayOS adapter không thay cho chữ ký/chứng từ/ngân hàng sandbox của nhà cung cấp. Unit test riêng kiểm tra chữ ký; chưa có giao dịch tiền thật trong đợt này.
- OCR, camera, barie, push, Android launcher widget và key hợp đồng production cần kiểm tra hạ tầng/thiết bị. Key hợp đồng trong test được sinh riêng trong bộ nhớ rồi bỏ.
- Widget/navigation tests kiểm tra hành vi Dart nhưng không chứng minh swipe back, font scale, bàn phím, dark mode và hiệu năng trên điện thoại thật.
- Browser chỉ chứng minh render/thao tác ở môi trường web đã xem; không suy ra toàn bộ back/resume và hiệu năng native từ 15 chuỗi HTTP pass.

## Kết quả kiểm tra toàn bộ và UI

- Backend sau bổ sung thông báo: **50 suites, 405/405 tests**, E2E **4/4**, TypeScript, oxlint và Nest build pass. Jest tự thoát với detectOpenHandles; lần cuối dùng testTimeout 30 giây cho máy kiểm thử. Cả 37 migration đã deploy trên DB test local ở vòng trước; không dùng reset/db push, không có migration mới cho thay đổi nội dung thông báo.
- Flutter sau bổ sung thông báo: **167/167 tests**, analyzer sạch, build web JavaScript pass. Build có cảnh báo font Cupertino; Wasm chưa tương thích dependency lưu trữ web hiện tại.
- Chạy app với `--dart-define=API_BASE_URL=http://127.0.0.1:3019`, JWT thật và dữ liệu giả local. Đã xem login, sơ đồ, home, ví, profile, payment history, session sheet, chọn ví, trạng thái đã thanh toán và QR ra; kiểm tra đến trang cuối payment và tải thêm ví giữ dòng/vị trí cũ.
- Kiểm tra khung 390×844: biển số, QR và mốc 15 phút nhìn thấy đủ. Thanh toán ví 38.000đ được đối chiếu DB: một payment Success đã applied, debit 20.000 BONUS + 18.000 CASH, không đóng phiên trước kiểm tra ra cổng.
- Tinh chỉnh giao diện sẵn có bằng Taste/Impeccable: số dư, nhãn bộ lọc, tải thêm, chuyển tab giữ state, row/sheet animation và reduced motion. Ảnh trước/sau và mã ra lưu ở [ui-review](ui-review/). Canvas/nhận diện mới vẫn tạm dừng.
- Thông báo end-user đã được chuẩn hóa qua backend envelope/filter và Flutter auth/error/snackbar; không hiển thị raw exception/Invalid credentials. Đã thử sai mật khẩu trên app local và lưu [ảnh](ui-review/login-readable-error.png). Các nhánh OTP, khóa tài khoản, thiếu số dư, chờ đối soát, timeout chưa rõ kết quả và lỗi kỹ thuật có test riêng. Tài liệu tổng hợp frontend/backend, exception đã có, phần chưa bao hàm và out of scope: [exception-status.md](exception-status.md).
