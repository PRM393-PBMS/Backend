# PBMS — trạng thái exception, hành trình và giới hạn kiểm chứng

Ngày bàn giao: 05/11/2026. Backend đã nhận main `da84263`, giữ bản vá chưa commit và stash dự phòng. Không có conflict Git còn treo; chưa push hoặc triển khai Supabase. Frontend được thao tác tại `../Frontend`, giữ giao diện hiện tại theo yêu cầu mới nhất; bản canvas/nhận diện mới đã tạm dừng.

## 1. Exception đã sửa trong đợt này

### Thanh toán và dữ liệu tiền

- Prepay/ví/checkout dùng khóa và transaction; không trừ ví hoặc cấp quyền hai lần khi request cạnh tranh. Payment, CASH/BONUS debit, ledger và quyền lợi rollback cùng nhau khi lỗi.
- PayOS lưu orderCode trước khi tạo link, phân biệt timeout chưa rõ kết quả với thất bại xác định. Webhook xác minh chữ ký và đọc trạng thái/số tiền từ provider. Không gọi provider trong transaction giữ khóa DB.
- Tách `paymentStatus=Success` khỏi `appliedAt`/`isApplied`/`applicationStatus`. Tiền đã nhận nhưng chưa áp dụng được không bị frontend/trang redirect báo là đã cấp quyền; cron có thể phục hồi phần áp dụng. Khoản thu trùng, tiền về trễ hoặc không thể cấp quyền được đối soát.
- Idempotency-Key được lưu ở DB; Flutter giữ key theo user/thao tác/payload khi timeout và loại mật khẩu/OTP khỏi khóa lưu local. Key không được dùng để lặp việc thu tiền dưới payload khác.
- Đổi PayOS sang ví phải xác minh/hủy order chờ. Gia hạn ví kiểm tra lại trạng thái, owner, phạm vi bãi và hợp đồng dưới khóa; dùng activation chung và snapshot gói đã chọn. Hai cron worker chỉ gia hạn một kỳ.
- CRUD payment không được bỏ qua luồng nghiệp vụ hoặc xóa chứng từ. Danh sách đối soát chỉ manager đọc; không có thao tác tự hoàn tiền.

### Vào/ra bãi và đặt chỗ

- Claim EntryPass/reservation, chiếm ô và tạo phiên nguyên tử; lỗi rollback, fallback ô trong cùng bãi. Xe máy giữ logic capacity theo tầng của main; xe ô tô giữ ô theo trạng thái có điều kiện.
- Mã ra có hiệu lực 15 phút kể từ quyết toán. Quá hạn tính lại tổng phí rồi trừ cọc và các khoản đã trả; không trừ hai lần, không trả số còn thu âm. Frontend ẩn mã hết hạn khi mở/resume và cho thanh toán phần còn thiếu.
- Tiền mặt được xác nhận cùng đóng phiên/hoàn tất reservation/nhả ô; màn khách tiếp tục polling khi không có OnlinePayment và đọc được payment đã Success sau staff xác nhận.
- Reservation dùng quota theo bãi và hold Pending 15 phút, tái sử dụng đơn Pending cùng ý định. Tiền cọc quá hold bị chặn ngay ở bước áp dụng, kể cả cron chưa chạy; đơn Cancelled/NoShow/Completed không được webhook khôi phục.
- Tạo lại link cọc được kiểm tra/khóa trước khi tạo nghĩa vụ mới; tiền đã nhận không được tạo cọc thứ hai. Provider lỗi không bị diễn giải thành đã hủy.
- Đổi/xóa xe và duyệt yêu cầu đổi biển số kiểm tra lại phiên active trong transaction, giữ biển số duy nhất và lịch sử.

### API, auth và phục hồi phía khách

- Exception envelope giữ `statusCode`, `message`, `isSuccess`, `result`; có `errorCode`, `requestId`, validation an toàn. HTTP khớp envelope; lỗi DB/upstream không giả thành danh sách rỗng hoặc lộ raw error.
- Kiểm tra UUID, số/ngày/trạng thái/quan hệ, ownership và tài khoản hoạt động. JWT secret không còn fallback hard-code; refresh PBMS giữ hợp đồng hiện tại, refresh service có rotation được consume nguyên tử.
- OTP có throttle/consume qua Redis. Bổ sung `POST /api/Auth/resend-register-otp` để nút gửi lại thực sự hoạt động mà không gửi lại mật khẩu; Flutter giữ thời gian chờ, chặn submit trùng và xóa cờ điều hướng cũ khi bắt đầu thao tác auth mới.
- Refresh cũ không được xóa token mới hoặc replay request sang tài khoản mới. Cache phiên offline theo user; phản hồi cũ khi đổi user bị bỏ qua. Ví cache kèm owner; logout xóa cache và widget.
- Không tin `status=success` của deep link; tải trạng thái server. Route lỗi có lối về màn chính. Không tự yêu cầu vị trí khi vào trang chủ; có timeout thay cho loading GPS vô hạn.
- Upload/OCR/QR kiểm tra nội dung ảnh, dung lượng/pixel và lỗi decode/provider. Hợp đồng kiểm tra PNG/hash/key/ký đồng thời với hủy. Báo cáo có validation ngày, giới hạn khoảng và xử lý stream.

## 2. Những phần đã có trong hệ thống và được giữ

- Main đã có ví CASH/BONUS, promo, ledger, autoRenew opt-in và gia hạn ví xác thực lại mật khẩu. Không loại bỏ hoặc tự viết lại các tính năng này khi merge.
- Đặt chỗ theo bãi, cửa sổ đến, quota, chính sách hoàn ví khi hủy reservation hợp lệ; quy tắc hoàn này khác với tiền về trễ/thu trùng cần đối soát.
- Vé tháng theo user/vehicle, bãi/ô cố định, hợp đồng dài hạn; mã ngắn 6 ký tự, camera/QR/nhập tay dự phòng, gate SSE, cash collection theo nhân viên/cổng.
- Lịch sử payment phân trang, biên lai/hóa đơn, floor layout, email change, Supabase Storage và quyền roleName.
- Giao diện teal/Be Vietnam Pro/cuống vé, trạng thái loading/empty/error và các animation có sẵn. Đợt này tinh chỉnh thay vì thay nhận diện.

## 3. Các chỉnh sửa Flutter và giao diện hiện có

- **Kết nối và lỗi API:** đọc envelope/validation có kiểm tra kiểu; lỗi tải dữ liệu không biến thành danh sách rỗng. Giữ metadata phục hồi, mã yêu cầu và thời gian chờ; che dữ liệu nhạy cảm trong log. `API_BASE_URL` có thể ghi đè bằng dart-define để chạy test local, mặc định deployment hiện tại được giữ.
- **Auth và điều hướng:** kiểm tra role customer/staff, từ chối role không xác định; xử lý cache đăng nhập hỏng. Refresh gắn với phiên gốc, không replay sang tài khoản khác. OTP gửi lại có endpoint thật, deadline đếm ngược, chặn submit/gửi trùng; back từ deep link có đích hợp lệ. Route không tồn tại có lối quay về.
- **Ví và nghĩa vụ tài chính:** key chống lặp gắn user/thao tác/payload, không lưu OTP/mật khẩu; không tự retry POST tài chính. Phân biệt tiền đã nhận với quyền đã áp dụng và chờ đối soát. Polling tiền mặt vẫn chạy sau khi staff xác nhận. Cache ví và phiên theo owner, bỏ response đến muộn của user cũ.
- **Phiên gửi và mã ra:** hiển thị khoản đã trả/phần còn thiếu; kiểm tra hạn 15 phút lúc mở, resume và khi đang xem. QR hết hạn hoặc không rõ hạn bị ẩn, có đường kiểm tra phí bổ sung. Widget Android giữ shortcut mở app, không giữ credential tĩnh sau khi hết hạn.
- **Trang chủ và danh sách:** không bật yêu cầu GPS ngay khi mở; thao tác xin vị trí có timeout 15 giây. Danh sách bãi dài được mở dần thay vì dựng toàn bộ; ví hiện 20 dòng rồi tải thêm; lịch sử payment dùng page API, giữ các dòng cũ khi tải, có trạng thái hết trang/thử lại và chống response filter cũ/dòng trùng. Nhãn bộ lọc vừa màn 390px.
- **Typography và motion:** giữ teal, Be Vietnam Pro, cuống vé và bố cục đang dùng. Số dư chính 38sp; chuyển tab 180ms vẫn giữ IndexedStack và state. Dòng mới xuất hiện 240ms, dịch 6px, stagger có giới hạn và không thay chiều cao; dòng cũ không chạy lại animation. Bottom sheet vào 220ms/ra 160ms. Nút ví điều hướng ngay; reduced motion bỏ chuyển động tương ứng.
- **Nội dung đúng nghiệp vụ:** hướng dẫn mã ra nêu hạn 15 phút; onboarding và màn thanh toán không hứa barie vật lý tự mở. Các trạng thái đã trả, đang kiểm tra, chờ đối soát và hết hạn có cách hiển thị riêng.
- **Thông báo end-user (bổ sung 05/11):** backend chuẩn hóa lỗi tại envelope/filter, Flutter chuẩn hóa tại `errorText`, auth BLoC, snackbar và error view dùng chung. Sai tên tài khoản hoặc mật khẩu đều hiện “Tài khoản hoặc mật khẩu không đúng. Vui lòng kiểm tra lại.”; 401 của phiên làm việc hướng dẫn đăng nhập lại, không nhầm với OTP hết hạn hay tài khoản bị khóa.
- **Thông báo có bước phục hồi:** thiếu số dư giữ khoản cần nạp; 429 giữ số giây chờ; email chưa xác nhận gửi nhắc kiểm tra hộp thư/thư rác; mạng/timeout giao dịch chưa rõ kết quả nhắc kiểm tra lịch sử trước khi thanh toán lại. Trạng thái chờ đối soát không bị đổi thành lời nhắc trả tiền hoặc retry chung.
- **Không đưa lỗi kỹ thuật lên màn hình:** bỏ nhánh auth trả `exception.toString()`, chặn lỗi tiếng Anh chưa dịch/stack/SQL/Prisma/HTML và thông tin cấu hình. Tên trường như `VehicleId`, `UserName` đổi thành “Xe”, “Tên đăng nhập”; validation dùng tên trường tiếng Việt. `errorCode`, `requestId`, details và HTTP vẫn giữ cho chương trình/hỗ trợ, không dùng làm lời nhắn chính. Thông báo ảnh quá lớn của staff sửa về giới hạn API 5 MB; 8 MB vẫn là dung lượng tổng hàng đợi ảnh trên máy.
- **Skill và cấu hình dự án:** Taste và Impeccable đã có trong `Frontend/.agents/skills/`, được dùng để rà hierarchy, kích thước điện thoại, motion và trạng thái phục hồi. `Frontend/PRODUCT.md` và `Frontend/DESIGN.md` lưu quyết định hiện hành. Workspace `pbms.code-workspace` có cả backend/frontend. Canvas nhận diện mới được giữ làm bản nháp tạm dừng, không phải thiết kế đã duyệt.

Các điểm đọc code chính: `Frontend/lib/core/widgets/pbms_motion.dart`, interceptor/API/cache trong `Frontend/lib/core/`, các feature auth/wallet/payment/parking và Android widget. Test bổ sung: `exception_recovery_test.dart`, `customer_session_cache_test.dart`, `customer_navigation_logic_test.dart`, `motion_pagination_test.dart` trong `Frontend/test/`.

## 4. Kiểm chứng thực tế

- Backend sau bổ sung thông báo: **405/405 tests, 50 suites**, gồm 15 chuỗi HTTP hành trình và 14 kiểm thử transaction/concurrency PostgreSQL. Jest `--detectOpenHandles` tự thoát, không dùng forceExit. Hai request tạo lại cọc chỉ tạo một payment Pending sau khi order trước bị hủy.
- E2E backend: **4/4 pass**; oxlint không còn cảnh báo, TypeScript và `npm run build` (Prisma 6.4.1 generate + Nest build) pass. Migration: **37 migration** deploy thành công trên DB test local mới; preflight không có dữ liệu vi phạm.
- Frontend sau bổ sung thông báo: **167/167 tests**, analyzer sạch, build web JavaScript thành công. Có test cache đổi tài khoản, OTP, tiền mặt, state tab, reduced motion, dòng phân trang không giật layout và thông báo qua API/auth/widget.
- Đã chạy Flutter thật trỏ API test local, dùng JWT và dữ liệu giả: login → sơ đồ → home → ví → thêm dòng → profile → lịch sử payment → trang cuối → phiên gửi → thanh toán ví → mã ra → quay về phiên. Kiểm tra cả khung 390×844; QR, biển số, giờ trả và giờ hết hạn hiển thị đầy đủ. Ảnh ở [ui-review](ui-review/), không phải canvas dựng thay app.
- Đối chiếu DB sau thao tác UI: đúng một payment PrepaidCheckout 38.000đ Success có appliedAt; BONUS giảm 20.000đ, CASH giảm 18.000đ, tổng ví còn 442.000đ. Phiên vẫn Active để nhân viên kiểm tra ra; paidAt 11:20, permit hết hạn 11:35 ngày 05/11/2026. Đây là dữ liệu giả local, không thu tiền/ngân hàng thật.
- Bằng chứng ảnh: [ví trước](ui-review/wallet-before.png), [ví sau](ui-review/wallet-after.png), [tải thêm ví](ui-review/wallet-load-more.png), [lịch sử](ui-review/payment-history.png), [trang cuối](ui-review/payment-history-last-page.png), [chọn thanh toán](ui-review/exit-payment.png), [đã thanh toán](ui-review/exit-paid.png), [mã ra](ui-review/exit-qr.png).
- Đã nghiệm thu thông báo sai mật khẩu trực tiếp qua Flutter → API local với tài khoản giả; trên khung 390×844 hiện đủ câu “Tài khoản hoặc mật khẩu không đúng. Vui lòng kiểm tra lại.”, không còn thông báo Invalid credentials. [Ảnh kiểm chứng](ui-review/login-readable-error.png). `test/user_message_test.dart` cũng kiểm tra dữ liệu API legacy, 401 đăng nhập, OTP hết hạn, 403 khóa tài khoản, 402, 429, chờ đối soát và timeout chưa rõ kết quả; `src/common/user-message.spec.ts` giữ HTTP/errorCode/details đồng thời chặn SQL/stack/HTML.
- Lần regression thông báo cuối dùng `npm test -- --runInBand --detectOpenHandles --testTimeout=30000`. Lần đầu một test PostgreSQL vượt giới hạn Jest 5 giây khi chạy nhiều kiểm tra; lần chạy lại đầy đủ đạt 405/405, không tăng timeout transaction nghiệp vụ. Assertion cũ kỳ vọng lộ “Transaction already closed” được sửa để yêu cầu lời nhắn tiếng Việt an toàn. Sau bản vá này TypeScript, oxlint, `npx nest build` và E2E 4/4 đều pass; schema/Prisma không đổi so với lần generate/build trước.
- Kết quả riêng từng hành trình ở [customer-journey-results.md](customer-journey-results.md). Chi tiết trigger/HTTP/test/phục hồi: [exception-matrix.md](exception-matrix.md), [exception-runbook.md](exception-runbook.md). Lệnh kiểm chứng: `npm test -- --runInBand --detectOpenHandles`, `npm run test:e2e -- --runInBand --detectOpenHandles`, `npx tsc --noEmit --incremental false`, `npm run lint`; Flutter `test`, `analyze`, `build web`.

## 5. Phần chưa có hoặc chưa xác nhận — không đánh dấu đã fix

- **Nội dung mới hoặc nhà cung cấp mới:** thông báo lỗi chưa nhận biết được dùng lời nhắn tiếng Việt an toàn theo HTTP; không tự suy đoán nguyên nhân từ chuỗi lỗi lạ. Khi thêm mã lỗi/module cần bổ sung lời nhắn và test. Nội dung do quản trị/người dùng tự nhập trong thông báo không bị tự dịch hoặc sửa ý nghĩa. Chưa nghiệm thu mọi thông báo hệ điều hành/plugin native trên thiết bị thật.

- **Hoàn tiền tự động, tự kết luận khoản thu thừa:** chưa có và không được tự quyết. Backend chỉ giữ chứng từ/trạng thái; quản lý quyết định theo chính sách.
- **Đối soát tự động dữ liệu Success cũ không có chứng cứ:** chưa có. Migration đánh dấu legacy cần review, không suy đoán đã cấp quyền hoặc phát lại quyền lợi.
- **Pagination snapshot/cursor cho dữ liệu thay đổi liên tục:** lịch sử vẫn theo page/pageSize; client chống request cũ và dòng trùng. Nếu trạng thái thay đổi trong lúc đọc nhiều trang, cần refresh để lấy tập mới. Chưa cung cấp snapshot nhất quán xuyên nhiều request.
- **Provider sandbox/hạ tầng thật:** chưa chạy giao dịch PayOS, gửi email, Redis failover hoặc OCR quota thật trong đợt này. Adapter test không chứng minh nhà cung cấp đang hoạt động.
- **Android/iOS thật:** chưa có thiết bị/emulator kết nối để nghiệm thu back gesture, bàn phím, biometrics, launcher widget, push, dark mode/font scale và hiệu năng. Bản vá Kotlin widget chưa được xác nhận bằng APK/device trong đợt này.
- **Wasm:** dependency `flutter_secure_storage_web` hiện dùng dart:html/js_util nên đích Wasm chưa được hỗ trợ; build web JavaScript đã pass. Build cũng cảnh báo font Cupertino, cần QA iOS/nhánh dùng Cupertino; không thêm dependency/đổi SDK để che cảnh báo.
- **Đo giao diện bằng DOM:** ảnh app và các thao tác được kiểm tra qua trình duyệt thật; không gán kết quả HTML/CSS inspector của canvas đề xuất cho Flutter CanvasKit. Chưa có bộ golden ảnh đa thiết bị hoặc chứng nhận accessibility/native toàn bộ app.
- **Không thể chứng minh không còn mọi bug:** các nhánh đã kiểm thử có bằng chứng nêu trên; không suy ra toàn bộ tổ hợp dữ liệu/provider/thiết bị đều đã được kiểm tra.

## 6. Ngoại lệ ngoài khả năng source tự giải quyết

- **Mất mạng/cold start/DNS/TLS/đồng hồ lệch:** lưu requestId, thời điểm, endpoint, mã giao dịch; truy vấn trạng thái trước retry. Đội vận hành kiểm tra mạng, chứng chỉ, NTP và hosting. Backend không khôi phục được mạng tầng hầm.
- **PayOS/ngân hàng gián đoạn hoặc thu tiền về trễ:** giữ orderCode/paymentId, số tiền, chứng từ ngân hàng và trạng thái hiện tại. Quản lý/provider đối soát; không tự trả tiền lần hai hay hoàn tiền khi chưa xác minh.
- **DB/Redis lỗi network, credential, quota hoặc mất dữ liệu:** readiness/503 giúp phát hiện, transaction giảm ghi một phần. Vận hành sửa cấu hình, quota, backup/restore; source không tái tạo dữ liệu đã mất mà không có backup.
- **Resend/email không đến:** lưu mã yêu cầu và thời điểm gửi, kiểm tra provider delivery/bounce; quản trị xác minh DNS/domain/quota/spam. Không thu thập OTP hay credential vào ticket.
- **Camera/barie/nguồn điện/biển số giả:** dùng nhập biển số/QR và nhân viên đối chiếu; bộ phận thiết bị và an ninh xử lý. API thành công không chứng minh barie vật lý mở hoặc người cầm xe là chủ hợp pháp.
- **OCR sai:** giữ ảnh phù hợp chính sách, confidence, ánh sáng và mã/biển đối chiếu; nhân viên xác nhận. Không có cam kết nhận diện tuyệt đối.
- **Disk đầy/mất ảnh do hosting:** kiểm tra quota/volume/bucket, file id và backup; vận hành cung cấp persistent storage. Catch không khôi phục ảnh đã mất.
- **Mất/đổi key hợp đồng:** giữ key ID và key cũ trong secret store; quản trị phục hồi/luân chuyển. Không tái tạo được chữ ký cũ từ private key đã mất. Việc hiệu lực pháp lý cần người có thẩm quyền.
- **Quyết định pháp lý/hoàn tiền và quy trình vận hành:** quản lý/chủ nghiệp vụ quyết định; backend cung cấp lịch sử và bằng chứng, không thay vai trò này.

Không đưa token, mật khẩu, OTP, secret key hoặc thông tin ngân hàng đầy đủ vào log/ticket. Xem runbook để đối soát theo mã lỗi và phân công phục hồi.
