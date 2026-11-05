# PBMS — trạng thái exception, hành trình và giới hạn kiểm chứng

Cập nhật: 05/11/2026. Backend đã nhận main `da84263`; người dùng đã push/merge/deploy vòng trước (HEAD quan sát `113bc40`). Các bản vá bổ sung bên dưới đang ở working tree, chưa do tôi commit/push hoặc deploy. Giữ stash dự phòng; không còn conflict Git. Frontend được thao tác tại `../Frontend`, giữ giao diện hiện tại theo yêu cầu mới nhất; bản canvas/nhận diện mới đã tạm dừng.

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

- Bổ sung hành trình sửa/xóa xe, đổi giờ đặt chỗ, promo, biên nhận PDF/hóa đơn và sự cố/thông báo. Customer không được gắn báo cáo vào lượt gửi xe của người khác; người xử lý phải là staff/manager đang hoạt động; staff không thể xác nhận xử lý dưới danh tính nhân viên khác.
- Hóa đơn được khóa theo payment khi gửi/sửa/xuất; request đồng thời cùng payment tái sử dụng Pending, không sửa thông tin sau Issued. Thông báo xuất hóa đơn không tuyên bố email đã gửi khi backend chỉ ghi nhận kế toán đã xuất.
- Assign/resolve/cancel sự cố dùng điều kiện trạng thái trong transaction. Không mở lại báo cáo terminal hoặc để cancel/resolve cùng thành công; thông báo dùng tên sự cố dễ hiểu.

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
- **Phân loại timeout theo thao tác:** đăng nhập/OTP/báo sự cố không hiển thị lời nhắc thanh toán lại. Lỗi chưa rõ kết quả của giao dịch tài chính vẫn nhắc kiểm tra lịch sử/trạng thái trước khi thanh toán lại, kể cả phiên cũ không có idempotency key local. Bản vá này chỉ chạm logic network; có test Dio riêng, không chạy UI/animation.
- **Thông báo có bước phục hồi:** thiếu số dư giữ khoản cần nạp; 429 giữ số giây chờ; email chưa xác nhận gửi nhắc kiểm tra hộp thư/thư rác; mạng/timeout giao dịch chưa rõ kết quả nhắc kiểm tra lịch sử trước khi thanh toán lại. Trạng thái chờ đối soát không bị đổi thành lời nhắc trả tiền hoặc retry chung.
- **Không đưa lỗi kỹ thuật lên màn hình:** bỏ nhánh auth trả `exception.toString()`, chặn lỗi tiếng Anh chưa dịch/stack/SQL/Prisma/HTML và thông tin cấu hình. Tên trường như `VehicleId`, `UserName` đổi thành “Xe”, “Tên đăng nhập”; validation dùng tên trường tiếng Việt. `errorCode`, `requestId`, details và HTTP vẫn giữ cho chương trình/hỗ trợ, không dùng làm lời nhắn chính. Thông báo ảnh quá lớn của staff sửa về giới hạn API 5 MB; 8 MB vẫn là dung lượng tổng hàng đợi ảnh trên máy.
- **Skill và cấu hình dự án:** Taste và Impeccable đã có trong `Frontend/.agents/skills/`, được dùng để rà hierarchy, kích thước điện thoại, motion và trạng thái phục hồi. `Frontend/PRODUCT.md` và `Frontend/DESIGN.md` lưu quyết định hiện hành. Workspace `pbms.code-workspace` có cả backend/frontend. Canvas nhận diện mới được giữ làm bản nháp tạm dừng, không phải thiết kế đã duyệt.

Các điểm đọc code chính: `Frontend/lib/core/widgets/pbms_motion.dart`, interceptor/API/cache trong `Frontend/lib/core/`, các feature auth/wallet/payment/parking và Android widget. Test bổ sung: `exception_recovery_test.dart`, `customer_session_cache_test.dart`, `customer_navigation_logic_test.dart`, `motion_pagination_test.dart` trong `Frontend/test/`.

## 4. Kiểm chứng thực tế

- Backend sau bổ sung checkout/incident/invoice/dependency: **414/414 tests, 50 suites**, gồm 24 nhánh hành trình và 14 test quy tắc/transaction/concurrency PostgreSQL. Sau đó mở rộng assertion GateScan trong J03/J05e/J06e và chạy lại riêng bộ hành trình: **24/24 pass**. Assertion bổ sung dùng cùng một EntryPass từ nhận diện đến check-in/checkout cũng pass khi chạy riêng J03. Jest `--detectOpenHandles` tự thoát, không dùng forceExit; không cộng hai lần chạy thành một tổng test. Chi tiết input/output và điểm cấn vừa sửa ở mục 8.
- E2E backend: **4/4 pass**; oxlint không còn cảnh báo, TypeScript và `npm run build` (Prisma 6.4.1 generate + Nest build) pass. Migration: **37 migration** deploy thành công trên DB test local mới; preflight không có dữ liệu vi phạm.
- Vòng Flutter lịch sử: **167/167 tests**, analyzer sạch, build web JavaScript thành công. Vòng API hiện tại sau sửa timeout: analyzer sạch và **17/17 test network/model/cache pass**, không chạy widget/UI/animation. Có test cache đổi tài khoản, OTP, tiền mặt, state tab, reduced motion, dòng phân trang không giật layout và thông báo qua API/auth/widget.
- Đã chạy Flutter thật trỏ API test local, dùng JWT và dữ liệu giả: login → sơ đồ → home → ví → thêm dòng → profile → lịch sử payment → trang cuối → phiên gửi → thanh toán ví → mã ra → quay về phiên. Kiểm tra cả khung 390×844; QR, biển số, giờ trả và giờ hết hạn hiển thị đầy đủ. Ảnh ở [ui-review](ui-review/), không phải canvas dựng thay app.
- Đối chiếu DB sau thao tác UI: đúng một payment PrepaidCheckout 38.000đ Success có appliedAt; BONUS giảm 20.000đ, CASH giảm 18.000đ, tổng ví còn 442.000đ. Phiên vẫn Active để nhân viên kiểm tra ra; paidAt 11:20, permit hết hạn 11:35 ngày 05/11/2026. Đây là dữ liệu giả local, không thu tiền/ngân hàng thật.
- Bằng chứng ảnh: [ví trước](ui-review/wallet-before.png), [ví sau](ui-review/wallet-after.png), [tải thêm ví](ui-review/wallet-load-more.png), [lịch sử](ui-review/payment-history.png), [trang cuối](ui-review/payment-history-last-page.png), [chọn thanh toán](ui-review/exit-payment.png), [đã thanh toán](ui-review/exit-paid.png), [mã ra](ui-review/exit-qr.png).
- Đã nghiệm thu thông báo sai mật khẩu trực tiếp qua Flutter → API local với tài khoản giả; trên khung 390×844 hiện đủ câu “Tài khoản hoặc mật khẩu không đúng. Vui lòng kiểm tra lại.”, không còn thông báo Invalid credentials. [Ảnh kiểm chứng](ui-review/login-readable-error.png). `test/user_message_test.dart` cũng kiểm tra dữ liệu API legacy, 401 đăng nhập, OTP hết hạn, 403 khóa tài khoản, 402, 429, chờ đối soát và timeout chưa rõ kết quả; `src/common/user-message.spec.ts` giữ HTTP/errorCode/details đồng thời chặn SQL/stack/HTML.
- Lần regression thông báo cuối dùng `npm test -- --runInBand --detectOpenHandles --testTimeout=30000`. Lần đầu một test PostgreSQL vượt giới hạn Jest 5 giây khi chạy nhiều kiểm tra; lần chạy lại đầy đủ ở vòng thông báo đạt 405/405; vòng bổ sung hiện đạt 414/414, không tăng timeout transaction nghiệp vụ. Assertion cũ kỳ vọng lộ “Transaction already closed” được sửa để yêu cầu lời nhắn tiếng Việt an toàn. Sau bản vá này TypeScript, oxlint, `npx nest build` và E2E 4/4 đều pass; schema/Prisma không đổi so với lần generate/build trước.
- Kết quả riêng từng hành trình ở [customer-journey-results.md](customer-journey-results.md). Chi tiết trigger/HTTP/test/phục hồi: [exception-matrix.md](exception-matrix.md), [exception-runbook.md](exception-runbook.md). Lệnh kiểm chứng: `npm test -- --runInBand --detectOpenHandles`, `npm run test:e2e -- --runInBand --detectOpenHandles`, `npx tsc --noEmit --incremental false`, `npm run lint`; Flutter `test`, `analyze`, `build web`.

## 5. Phần chưa có hoặc chưa xác nhận — không đánh dấu đã fix

- **Nội dung mới hoặc nhà cung cấp mới:** thông báo lỗi chưa nhận biết được dùng lời nhắn tiếng Việt an toàn theo HTTP; không tự suy đoán nguyên nhân từ chuỗi lỗi lạ. Khi thêm mã lỗi/module cần bổ sung lời nhắn và test. Nội dung do quản trị/người dùng tự nhập trong thông báo không bị tự dịch hoặc sửa ý nghĩa. Chưa nghiệm thu mọi thông báo hệ điều hành/plugin native trên thiết bị thật.

- **Hoàn tiền tự động, tự kết luận khoản thu thừa:** chưa có và không được tự quyết. Backend chỉ giữ chứng từ/trạng thái; quản lý quyết định theo chính sách.
- **Đối soát tự động dữ liệu Success cũ không có chứng cứ:** chưa có. Migration đánh dấu legacy cần review, không suy đoán đã cấp quyền hoặc phát lại quyền lợi.
- **Pagination snapshot/cursor cho dữ liệu thay đổi liên tục:** lịch sử vẫn theo page/pageSize; client chống request cũ và dòng trùng. Nếu trạng thái thay đổi trong lúc đọc nhiều trang, cần refresh để lấy tập mới. Chưa cung cấp snapshot nhất quán xuyên nhiều request.
- **Theo yêu cầu mới, nghiệm thu UI/native do người dùng thực hiện trên APK:** không chạy thêm animation, web preview hoặc emulator. Kiểm thử tự động tiếp tục tập trung API; không đánh dấu trải nghiệm trên điện thoại là đã nghiệm thu chỉ từ kết quả API.
- **Provider sandbox/hạ tầng thật:** chưa chạy giao dịch PayOS, gửi email, Redis failover hoặc OCR quota thật trong đợt này. Adapter test không chứng minh nhà cung cấp đang hoạt động.
- **Android/iOS thật:** chưa có thiết bị/emulator kết nối để nghiệm thu back gesture, bàn phím, biometrics, launcher widget, push, dark mode/font scale và hiệu năng. Kotlin widget đã qua biên dịch APK; hoạt động widget, gesture và plugin trên thiết bị vẫn do người dùng nghiệm thu.
- **Wasm:** dependency `flutter_secure_storage_web` hiện dùng dart:html/js_util nên đích Wasm chưa được hỗ trợ; build web JavaScript đã pass. Build cũng cảnh báo font Cupertino, cần QA iOS/nhánh dùng Cupertino; không thêm dependency/đổi SDK để che cảnh báo.
- **Toolchain Android còn cảnh báo:** Kotlin embedded/plugin không cùng phiên bản khuyến nghị, DSL/Kotlin Gradle legacy và một số plugin dùng Java 8 deprecated. Không đổi SDK/plugin hàng loạt trong vòng sửa logic; cần nhánh nâng tương thích và QA riêng. Đây là phần source/toolchain có thể xử lý tiếp, không xếp vào ngoại lệ bất khả thi bằng code.
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

## 7. Cảnh báo dependency và install script trên Render

Đối chiếu ngày 05/11/2026: `npm audit --omit=dev` ban đầu khớp log Render: 6 mục (1 moderate, 4 high, 1 critical). Đây là các mục audit gồm cả package bị ảnh hưởng gián tiếp, không đồng nghĩa 6 lỗ hổng độc lập hoặc đã bị khai thác.

- Đã nâng `@nestjs/platform-express` lên 12.3.3 và Sharp lên 0.35.5; lockfile nhận Express 5.3.0, Multer 2.5.0 và các bản vá body-parser/proxy-addr/qs. Prisma và client giữ 6.4.1. Không hạ Nest/Jest hoặc dùng `audit fix --force`.
- Advisory critical `proxy-addr` liên quan cấu hình trust proxy/subnet IPv4-mapped IPv6; bản 2.0.8 có bản vá. Sharp 0.35.5 dùng libvips 8.18.7. Nguồn: [proxy-addr advisory](https://github.com/advisories/GHSA-jqcg-44mw-7w3h), [Sharp advisory](https://github.com/advisories/GHSA-f88m-g3jw-g9cj), [Sharp changelog](https://sharp.pixelplumbing.com/changelog/v0.35.5/).
- Override có phạm vi cho `@nestjs/mau → undici` và `external-editor → tmp` xử lý hai mục high ở công cụ phát triển. Đã smoke test API external-editor/tmp và tải undici; không chạy lệnh deploy của Mau.
- Kết quả sau vá: **runtime audit 0**; toàn bộ cây dependency còn **21 mục dev (4 low, 17 moderate), không high/critical**. Các mục còn lại nằm ở deepmerge/glob/minimatch và chuỗi công cụ Jest/Nest CLI; chưa ép nâng/hạ major để làm số audit bằng 0. Cần theo dõi bản upstream và kiểm chứng tương thích riêng; đây là hạng mục còn theo dõi, không phải bất khả thi bằng code.
- `allowScripts` pin đúng phiên bản đã rà của Prisma client/engines/CLI, bcrypt, esbuild và Parcel watcher. Từ chối `@scarf/scarf`. Sharp mới không còn install script cũ cần duyệt. Danh sách unreviewed trả rỗng. Docker build pin npm 11.21.2 và dùng `npm ci --strict-allow-scripts`; package có script mới sẽ cần được rà thay vì tự cho chạy.
- Clean runtime install bằng npm 11.21.2, `--omit=dev --strict-allow-scripts` đã pass trong thư mục tạm riêng. Prisma 6.4.1 load được, bcrypt hash/compare và Sharp encode/decode PNG pass. Dev tools được loại khỏi runtime. Chưa build Docker Linux tại local vì không có Docker CLI; cần Render rebuild bản vá mới.

Kiểm tra lại khi thay dependency: `npm audit --omit=dev`, `npm audit`, và `npx --package=npm@11.21.2 npm install-scripts ls --json`. Theo [npm install-scripts](https://docs.npmjs.com/cli/v11/commands/npm-install-scripts/), approval pin theo package/version; không dùng approve tất cả để ẩn cảnh báo.

Backend Render được kiểm tra ở URL đang cấu hình trong Flutter: `https://prm393backend.onrender.com`. `/health` và `/health/ready` đều trả 200 ngày 05/11/2026. Người dùng xác nhận các biến cấu hình đã có trên Render. Kiểm tra này xác nhận liveness và DB/Redis readiness, không thay cho kiểm chứng PayOS/email/OCR end-to-end. Các bản vá dependency, sự cố và hóa đơn trong vòng bổ sung này cần được người dùng push/deploy thêm; chưa ghi nhận chúng đã nằm trên Render.

## 8. Chốt plan theo flow input → xử lý → output (05/11/2026)

### Tiêu chí kết luận

Một flow là một chuỗi nghiệp vụ của khách/nhân viên, dùng tiếp vehicleId, reservationId, sessionId và paymentId của bước trước; không tính mỗi endpoint là một flow. Kiểm tra HTTP/envelope, quyền, dữ liệu DB, trạng thái để đi tiếp và trạng thái cuối. Bộ HTTP hiện có **24/24 nhánh pass** trên PostgreSQL local, JWT/guard/controller thật; PayOS, OTP/email và OCR/storage là adapter giả. Không suy ra độ chính xác OCR, thời gian chuyển khoản, SSE qua Render hoặc độ mượt điện thoại từ kết quả này.

### Các flow đã test

1. **Tài khoản — J01, J01b (2 nhánh).** Input đăng ký/OTP hoặc email+mật khẩu → gửi lại/xác minh → login → profile → refresh/logout; quên mật khẩu → xác minh/reset → kiểm tra refresh cũ bị từ chối. Output: đúng tài khoản/quyền, token cho bước sau; mã chờ gửi lại được giữ. API chính: Auth, profile. Thông báo sai đăng nhập tiếng Việt có test riêng.

2. **Xe — J02, J02b (2 nhánh).** Input loại xe+biển số → tạo → đọc danh sách của mình → sửa xe chưa dùng → xóa xe chưa dùng. Output: vehicleId dùng được ngay cho EntryPass/reservation/subscription. Biển trùng, quyền người khác và sửa/xóa xe đang gửi bị chặn. Fixture mỗi flow bên dưới tạo xe qua HTTP, không chèn sẵn vehicle thay cho thao tác đăng ký.

3. **Gửi một lần, trả ví, ra bãi — J03, J03b (2 nhánh).** Khách tạo EntryPass → staff chọn cổng, gửi ảnh vào GateScan → nhận gợi ý EntryPass → check-in → staff đọc session/biển số/status và giải QR → khách đọc phiên/phí → prepay ví → mã ra → GateScan cổng ra nhận Checkout → staff checkout → Completed/lịch sử. Quét lại ở cổng vào khi xe đã gửi nhận Inside. Thiếu ví rollback; nạp rồi retry cùng ý định có thể thành công. Output: một phiên, một debit thành công, payment đã applied; quét/prepay lặp không thu hai lần.

4. **Trả PayOS, mã hết hạn, thu bổ sung — J04 (1 nhánh).** Input phiên đang gửi → tạo payment → provider giả PAID → sync → mã ra → giả lập vượt hạn 15 phút → fee-preview trừ khoản đã trả → trả phần chênh bằng ví → staff checkout. Output: tổng payment Success bằng tổng phí, session Completed; không trừ lại khoản cũ. Biên đúng 15 phút/qua hạn có test quy tắc riêng. Chưa có thanh toán ngân hàng thật.

5. **Đặt chỗ — J05, J05b–J05e (5 nhánh).** Input bãi/xe/giờ → quota → tạo đơn/cọc → sync Confirmed → GateScan nhận Reservation và đúng reservationId → staff đọc đơn, check-in → khách/staff đọc cùng phiên Active → tính phí trừ cọc → checkout → session/reservation Completed, ô Available. Nhánh xuyên suốt cuối kiểm tra trường hợp cọc đã đủ nên không phát sinh CheckoutFee; quét checkout lại không tạo khoản thu. Nhánh phụ: POST trùng tái dùng, hủy/tiền đến trễ vào đối soát, hold quá hạn trước cron, tạo lại link cạnh tranh, đổi giờ một lần và hủy hoàn cọc đúng một lần.

6. **Vé tháng — J06, J06b–J06e (5 nhánh).** Input xe/gói/bãi/ô → trả ví hoặc ký hợp đồng rồi PayOS → Active → GateScan nhận Resident và đúng subscriptionId → vào tầng cư dân → staff đọc phiên/ô → phí nằm trong gói → checkout → session Completed, ô vẫn Assigned, vé vẫn Active. EntryPass đã có từ trước được giữ khi check-in dùng vé tháng. Nhánh vòng đời khác: gia hạn một kỳ, autoRenew mặc định tắt, hai worker chỉ thu một kỳ, không đổi phạm vi gói ngầm, hủy rồi không được gia hạn, chặn trả khi chưa ký.

7. **Ví, promo, lịch sử, chứng từ — J07, J07b–J07d (4 nhánh).** Input số tiền/mã promo → kiểm tra → tạo top-up → sync lặp/đồng thời → CASH/BONUS/ledger → lịch sử phân trang → PDF → yêu cầu hóa đơn → manager xuất → thông báo. Output: một lần cộng tiền, trang cuối rỗng hợp lệ, PDF thật qua HTTP; Pending được tái dùng, Issued không bị sửa kể cả request cạnh tranh. Key trùng/payload khác và truy cập chứng từ người khác bị chặn.

8. **Thu tiền mặt, sự cố, thông báo — J08, J08b, J08c (3 nhánh).** Khách vào bãi → staff yêu cầu checkout tiền mặt → khách poll Pending → staff confirm-cash → khách poll Success đã applied. Nhánh sự cố: khách gửi theo phiên của mình → phân công staff → resolve/cancel → đọc/read-all/xóa thông báo. Output: không mắc ở Pending, không xử lý dưới danh tính staff khác; resolve/cancel cạnh tranh chỉ một trạng thái cuối thắng, không mở lại terminal. Test PostgreSQL riêng xác nhận hai staff confirm-cash chỉ đóng phiên/nhả ô một lần.

### API nhận diện và bước staff xử lý đã được nối

Frontend nhân viên thực tế gọi `GET /api/GateScan/my-gate`, `POST /api/GateScan` multipart và `GET /api/GateScan/recent`; API thao tác phiên là `ParkingOperation/check-in`, `ParkingSession/:id`, fee-preview và check-out/confirm-cash. Test J03/J05e/J06e đi qua GateScan và kiểm tra gợi ý EntryPass/Inside/Checkout/Reservation/Resident trước bước nghiệp vụ tương ứng. Gợi ý quét chỉ hỗ trợ chọn thao tác; check-in/checkout vẫn xác thực quyền, biển số, bãi, trạng thái và nghĩa vụ tiền.

### Điểm cấn mới phát hiện khi nối đủ chuỗi và đã vá

- Checkout vé tháng đọc session bằng connection ngoài transaction nên response có thể còn Active dù đã đóng. Nay đọc cùng transaction và trả Completed.
- Checkout đặt chỗ/cọc đã đủ gọi đóng phiên bằng connection ngoài transaction đang giữ khóa dòng, gây chờ khóa rồi lỗi CONCURRENT_OPERATION. Nay cập nhật phiên/reservation/ô và đọc kết quả dùng cùng transaction. Hai test mới thất bại trước bản vá và pass sau bản vá.

### Phần chưa đủ bằng chứng để gọi mọi flow đều mượt

- Luồng xe máy theo capacity tầng, xe vãng lai không tài khoản và mọi biến thể nhiều bãi/ô đầy chưa có chuỗi HTTP xuyên suốt riêng trong bộ 24 nhánh; một số quy tắc có service/unit test, không đánh đồng với nghiệm thu flow.
- Chưa chạy xuyên suốt web staff thực tế, SSE/reconnect qua Render, camera/OCR thật, email/OTP thật hoặc PayOS sandbox/ngân hàng. GateScan stream và cổng trực hiện ở bộ nhớ một process; restart/multi-instance cần quy trình hoặc cơ chế chia sẻ, chưa kiểm chứng triển khai nhiều instance.
- Chưa đo latency/p95 hoặc load test; “đạt logic API” không phải cam kết thời gian phản hồi trên mạng tầng hầm/cold start.
- Backend Render đã deploy vòng trước; các bản vá checkout/incident/invoice/dependency vòng bổ sung phải push/deploy lại. Chưa chạy thao tác ghi tài chính trên Render/Supabase.
- UI/animation không chạy lại theo yêu cầu; người dùng nghiệm thu APK trên điện thoại. Các vấn đề hạ tầng/thiết bị và quyết định hoàn tiền xem mục 5–6.

**Kết luận plan:** chốt được phạm vi và bằng chứng cho 8 nhóm/24 nhánh trên môi trường local. Các chuỗi chính khách → staff → trạng thái cuối nêu trên đã nối và pass; chưa có cơ sở tuyên bố toàn bộ tổ hợp end-user trên production đã mượt hoặc task tổng thể hoàn tất 100%.

## 9. Cài APK trên điện thoại để tự nghiệm thu

**APK kiểm thử đã tạo:** [app-release.apk](C:/Users/PHONG/Desktop/Coding_Proj/FPT/Semester_8/Backend_PRM393/Codebase/Frontend/build/app/outputs/flutter-apk/app-release.apk). PBMS 1.0.0 (build 1), Android **7.0/API 24 trở lên**, target API 36; gồm arm64-v8a, armeabi-v7a và x86_64. Dung lượng 69.791.152 byte (~66,6 MiB). `apksigner verify` pass (v2), certificate Android Debug; chưa cài/chạy trên thiết bị.

SHA-256: `8306F45CBFB1601D973CB3180577BAA41F8A33772A3E38FF3EA137CFA7AE48AF`.

Bản kiểm thử dùng API `https://prm393backend.onrender.com`. Các biến dịch vụ nằm ở Render theo xác nhận của người dùng; không chép DB URL, JWT secret, key PayOS/Resend/OCR vào app. Thiết bị cần Internet, không dùng URL localhost của máy tính.

### Cài và mở app

1. Chép file APK từ máy tính vào thư mục Downloads trên điện thoại Android bằng USB/File Transfer hoặc kênh chuyển file của bạn.
2. Mở APK bằng ứng dụng quản lý tệp. Nếu Android yêu cầu, cho phép **cài ứng dụng từ nguồn này** đối với đúng ứng dụng đang mở APK; tiếp tục Cài đặt → Mở. Giữ Play Protect hoạt động; nếu bị chặn, ghi lại thông báo để kiểm tra, không tắt bảo vệ toàn máy.
3. Đăng nhập tài khoản customer để chạy luồng khách. App nhân viên là máy quét; dùng tài khoản staff và web staff để chọn cổng/xử lý lượt quét, không dùng tài khoản khách để gọi check-in/checkout.
4. Chỉ cấp camera/vị trí/thông báo khi cần thao tác tương ứng. Không bắt buộc USB debugging nếu cài qua quản lý tệp.
5. Nếu báo chữ ký không khớp với bản đã cài, cần APK ký cùng key để cập nhật. Gỡ bản cũ sẽ xóa dữ liệu local; người dùng cân nhắc trước khi gỡ. Cấu hình release hiện tại ký bằng debug key để kiểm thử, chưa phải bản phát hành Play Store.

Tham khảo: [Flutter Android deployment](https://docs.flutter.dev/deployment/android), [Android/Pixel: cài ứng dụng từ nguồn khác](https://support.google.com/pixelphone/answer/7391672).

### Nếu muốn tự build lại trên máy này

Chạy PowerShell:

```powershell
Set-Location 'C:/Users/PHONG/Desktop/Coding_Proj/FPT/Semester_8/Backend_PRM393/Codebase/Frontend'
& 'C:/Users/PHONG/Desktop/Coding_Proj/FPT/Semester_8/flutter/bin/flutter.bat' build apk --release --dart-define=API_BASE_URL=https://prm393backend.onrender.com
```

Lệnh build chuẩn khi thành công xuất `Frontend/build/app/outputs/flutter-apk/app-release.apk`. Lỗi TLS/connection reset lúc tải Gradle/Maven là kết nối build tới kho thư viện, không phải thiếu biến backend trên Render. Trong vòng này đã dùng thư viện đúng phiên bản từ Google Maven/Maven Central và kiểm checksum, phục hồi metadata Gradle khi cần; cấu hình repository/phiên bản dependency của source Flutter không đổi, không tắt TLS. Công cụ phục hồi nằm trong `backend/.tmp`, không đưa vào source phát hành.

### Checklist nghiệm thu trên máy thật

Thực hiện 8 nhóm flow ở mục 8 bằng tài khoản/dữ liệu kiểm thử được phép. Với luồng ra bãi, kiểm tra cả hai phía: app khách thấy đúng xe/phiên/khoản còn thu; web staff thấy đúng biển số/bãi/status; sau checkout session Completed và ô đúng trạng thái. Vé tháng phải giữ ô Assigned; reservation phải Completed và không thu cọc lần nữa.

Với PayOS/OTP/email/OCR, ghi nhận việc nhà cung cấp thực sự phản hồi; API adapter test không xác nhận thay. Không thử trả nhiều lần khi chưa rõ kết quả: mở lại lịch sử/trạng thái trước. Kiểm tra mốc mã ra 15 phút và thanh toán bổ sung. Cần push/deploy backend chứa bản vá vòng bổ sung trước khi nghiệm thu các lỗi vừa sửa trên Render.

Khi gặp lỗi, ghi flow/bước, giờ Việt Nam, hành động vừa thực hiện, message người dùng, requestId, sessionId/paymentId phù hợp và ảnh màn hình. Không gửi token, OTP, mật khẩu hoặc secret. Vòng này không tự chạy UI/animation/emulator; trải nghiệm native được người dùng đánh giá sau cài APK.
