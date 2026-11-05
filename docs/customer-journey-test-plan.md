# Kiểm thử hành trình khách hàng trước khi làm đẹp UI

Cập nhật theo yêu cầu ngày 05/11/2026: dừng canvas/nhận diện mới; ưu tiên logic và giữ giao diện hiện tại. Taste và Impeccable chỉ dùng để cải thiện UI sau khi các luồng đã qua kiểm tra.

## Cách thực hiện và tiêu chí đạt

1. Đối chiếu từng màn Flutter với endpoint, body, ownership, trạng thái trả về và màn tiếp theo.
2. Chạy chuỗi HTTP qua controller/guard/interceptor thật, JWT thật và PostgreSQL local test riêng. PayOS/email/OCR/OTP provider được thay bằng adapter kiểm soát được; không thu tiền, gửi email hoặc sửa dữ liệu production.
3. Mỗi bước kiểm tra cả HTTP/envelope và dữ liệu sau bước đó. Không chỉ kiểm tra một endpoint trả 200: phải dùng id/token/payment của bước trước cho bước sau.
4. Điểm “cấn” gồm màn sau thiếu dữ liệu, không thể quay lại, phải trả tiền lại, ownership khác nhau, trạng thái chưa áp dụng bị báo thành công, không cập nhật sau back/resume, phân trang lặp/mất dòng và loading/error làm người dùng mắc kẹt.
5. Sửa logic trước; thêm regression test cho nguyên nhân đã xác nhận. Chạy lại luồng bị ảnh hưởng và các kiểm tra chung, rồi mới chỉnh UI.

## Hành trình J01 — Tài khoản và khôi phục phiên

Mở app → đăng nhập → hồ sơ → refresh → đổi tài khoản/đăng xuất. Kiểm tra sai mật khẩu, token hết hạn, tài khoản bị khóa sau login, request đang chạy khi đổi tài khoản và dữ liệu cache hỏng. OTP đăng ký/reset có nhánh mã sai/hết hạn/429; adapter giả không thay cho xác nhận Redis/Resend thật.

API chính: `/api/Auth/login`, `/api/profile`, `/api/Auth/refresh-token`, `/api/Auth/logout`; đối chiếu DTO và refreshTokenKey hiện có. Đạt khi không vòng redirect, không phục hồi phiên đã thoát, không replay POST của user cũ dưới user mới và không xóa phiên mới vì refresh cũ trả lỗi.

## Hành trình J02 — Khám phá bãi và quản lý xe

Trang chủ → bãi/loại xe/giá → thêm xe → danh sách/chi tiết → sửa/xóa. API: `/parkings/available`, `/api/VehicleType`, `/api/PricingPolicy`, `/api/vehicles`, `/api/vehicles/my`.

Nhánh lỗi: biển số trùng, loại xe không tồn tại, UUID sai, người khác đọc/sửa, xe đã có lịch sử hoặc đang trong bãi. Đạt khi lỗi không biến thành danh sách rỗng và xe mới dùng ngay được ở bước đặt chỗ/EntryPass.

## Hành trình J03 — Gửi một lần và trả bằng ví

Chọn xe → tạo EntryPass → staff quét cổng → khách xem phiên/vị trí/phí → trả ví → đọc mã ra → staff checkout → lịch sử. Kiểm tra quét lặp, khác bãi/biển số, ví thiếu tiền và POST lặp cùng key.

API: `/api/entry-passes`, check-in/check-out của ParkingOperation, `/api/ParkingSession/my`, `my/:id/fee-preview`, `my/:id/prepay`, `my/:id/exit-pass`, `/api/payments/my`.

Đạt khi có một phiên, một debit, một quyền ra hợp lệ; ô/EntryPass rollback khi lỗi; sau checkout không còn phiên active và lịch sử có đúng khoản thu.

## Hành trình J04 — PayOS, timeout và quyết toán lại

Phiên đang gửi → tạo PayOS → đóng/mở lại trang → sync/webhook → mã ra; quá 15 phút → tính lại tổng phí → chỉ thu chênh lệch → checkout. Kiểm tra Success nhưng chưa applied, đối soát, webhook lặp/trễ, hủy chưa xác định và chuyển phương thức.

Đạt khi frontend chỉ báo hoàn tất sau `isApplied`, timeout giữ ý định/key, mã cũ bị ẩn đúng hạn, tiền cọc/phí đã trả chỉ trừ một lần và số còn thu không âm. Không gọi PayOS thật trong test.

## Hành trình J05 — Đặt chỗ ô tô

Chọn bãi/xe/giờ → xem quota → đặt chỗ → cọc → xác nhận → đổi giờ/hủy hoặc check-in → checkout. Kiểm tra Pending hết 15 phút giữ chỗ, đơn trùng, quota tranh chấp, tiền về sau cancel/NoShow và ownership.

API: `/api/reservations/availability`, `/api/reservations`, `my-reservations`, `:id`, `:id/recreate-payment`, `:id/change-time`, `:id/cancel`, payment sync. Đạt khi giữ đúng bãi, không tạo nghĩa vụ cọc thứ hai và đơn terminal không được webhook phục hồi.

## Hành trình J06 — Vé tháng và hợp đồng

Chọn xe/gói/bãi/ô → đăng ký → ký nếu cần → trả ví/PayOS → Active → vào/ra → gia hạn → hủy. Kiểm tra gói dài hạn cần ký, autoRenew opt-in, snapshot gói gia hạn, quyền bãi, claim ô cố định đồng thời và không gia hạn vé hủy.

API lấy theo `/api/MonthlySubscription`, `/api/contracts`, `/api/SubscriptionRenewal` hiện có. Đạt khi cùng quy tắc activation ở mọi kênh, gói/bãi không bị đổi ngầm, wallet và PayOS không áp dụng hai lần và mã EntryPass cũ không bị consume khi dùng vé tháng.

## Hành trình J07 — Ví, lịch sử và phân trang

Mở ví → xem tiền gốc/khuyến mãi → chọn promo → nạp → sync → ledger → lịch sử payment → biên lai/hóa đơn. Kiểm tra page/pageSize/status, ranh giới cuối trang, tải thêm lặp, request cũ trả về sau đổi filter và error/retry không xóa các dòng đã tải.

API: `/api/wallet`, `:id/top-up`, transactions/top-ups/spends, `/api/PromoCode/available`, `/api/payments/my`, `/api/receipts`. Đạt khi số dư/ledger khớp, mỗi trang không trùng/mất dòng và không dựa vào Success đơn thuần để giả cập nhật ví.

## Hành trình J08 — Thu tiền mặt, sự cố và thông báo

Staff tạo yêu cầu checkout → khách mở màn tại cổng → staff xác nhận tiền mặt → màn khách tự cập nhật → lịch sử. Tiếp tục thông báo/read-all, báo sự cố và quay lại màn trước.

Đạt khi tiền mặt vẫn polling được dù không có OnlinePayment, không treo loading, lỗi provider không làm đóng phiên và bản ghi thu tiền giữ đúng nhân viên/cổng. Không thông báo barie vật lý đã mở chỉ dựa vào response API.

## Nghiệm thu hiện hành

Theo yêu cầu mới nhất, không chạy thêm UI/animation/emulator. Chốt flow theo input → thao tác khách/staff → API nhận diện → biến đổi trạng thái → output cuối. Kết quả 24 nhánh cùng ranh giới local/provider/native ở [exception-status.md, mục 8](exception-status.md#8-chốt-plan-theo-flow-input--xử-lý--output-05112026). Các bước giao diện dưới đây là kế hoạch lịch sử; người dùng tự nghiệm thu trên APK.

## Sau khi logic đạt

- Chạy Flutter hiện tại trên browser/device có sẵn, xem các màn thật và trạng thái loading/empty/error/long text.
- Giữ nhận diện và bố cục hiện tại; chỉnh hierarchy, spacing, copy, accessibility và các chi tiết gây cấn. Không tiếp tục đề xuất nhận diện mới trong vòng này.
- Animation có mục đích: chuyển tab/trang, mở sheet, phản hồi thao tác, danh sách và tải trang tiếp. Giữ dữ liệu/scroll khi tải thêm, khóa request trùng, hỗ trợ reduced motion; không delay xác nhận tiền hoặc dùng animation thay loading/error.
- Nghiệm thu riêng logic API, widget/navigation và render. Browser không chứng minh gesture/keyboard/hiệu năng trên Android/iOS thật; ghi rõ bằng chứng và phần chưa kiểm tra.

## Hồ sơ kết quả

Ghi phát hiện, nguyên nhân, bản vá, test và phần chưa kiểm chứng vào `docs/customer-journey-results.md`; cập nhật tài liệu exception tổng hợp. Không gọi một luồng “mượt” chỉ dựa vào unit test.
