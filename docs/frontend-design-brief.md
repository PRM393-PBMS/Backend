# Canvas khách hàng PBMS — bản chờ duyệt

> **Tạm dừng theo yêu cầu mới nhất.** Chủ dự án chuyển sang kiểm tra luồng/API và sửa logic trước, sau đó tinh chỉnh giao diện Flutter hiện tại bằng Taste/Impeccable. Phần dưới là đề xuất nhận diện cũ, chưa duyệt và không phải chỉ dẫn thay theme. Kết quả hiện hành: [exception-status.md](exception-status.md).

## Quyết định của chủ dự án

- Ưu tiên app khách hàng; chưa thiết kế lại màn quét staff hoặc web quản trị.
- Đề xuất nhận diện mới để duyệt. Giữ tên PBMS, tính năng và dữ liệu nghiệp vụ hiện có.
- Chỉ thay giao diện Flutter sau khi duyệt canvas. Bản demo dùng dữ liệu minh họa, không kết nối thanh toán thật.

## Công việc phải nhìn thấy trong canvas

Trang chủ trả lời “xe đang ở đâu, còn phải trả bao nhiêu, thao tác tiếp theo là gì?”. Ví phân biệt tiền gốc và khuyến mãi. Checkout phân biệt chưa trả, đang xác minh, đã áp dụng, hết hạn mã và chờ đối soát. QR chưa xác minh hoặc hết hạn không được vẽ thành mã có thể dùng.

Điện thoại cần đích chạm 48dp, điều hướng quen thuộc, tiếng Việt đầy đủ và VND. Trên màn lớn chuyển navigation bar sang rail; không phóng to bản điện thoại. Hỗ trợ chữ lớn, dark theme, safe area, back gesture và reduced motion khi triển khai native.

## Taste và Impeccable

Taste áp dụng nhánh app-screen, không áp template landing page. Đã lưu `achromatic-ledger`, seed `1842267314`: nền trung tính, chữ tiền căn theo cột, đen cho hành động chính, màu trạng thái chỉ khi cần. Impeccable áp dụng mode `operate`: cấu trúc và controls tuân theo nền tảng; thế giới thị giác chỉ tác động type, màu, mật độ và một chi tiết nhận diện.

Hai guideline có khác biệt về mức màu: vòng này ưu tiên sự rõ ràng của Taste ở các giao dịch tài chính; các hướng nhiều màu chỉ là phương án so sánh, không trộn nhiều hệ vào một app.

## Các nguồn phát triển hướng nhận diện

1. Wayfinding đô thị: đọc vị trí nhanh; nền sáng, chữ sans, biển vị trí và nhịp khoảng cách rõ ràng.
2. Thời khóa biểu: quen thuộc với người đi học/đi làm; cột giờ thẳng, ít màu, nhóm theo ngày và việc cần làm.
3. Tạp chí kiến trúc: bãi/tầng/ô được đặt trong bối cảnh không gian; khoảng trắng và typography mạnh, hình chỉ khi có dữ liệu thật.
4. Bảng tin khu dân cư: gần gũi với người dùng bãi tòa nhà; thông tin có tiêu đề rõ, trạng thái hiện tại đứng trước tin phụ.
5. Mục lục thư viện: mỗi xe có một hồ sơ rõ ràng, hành trình có thứ tự; nền trắng, chữ mực, mã xe/vị trí có vị trí cố định, tiền và trạng thái không tranh nhau.
6. Sao kê cá nhân: tài chính kiểm chứng được; chia tiền gốc/khuyến mãi, dòng thu/chi thẳng cột, thông tin đối soát dễ tìm.
7. Sổ mua hàng khu phố: ghi nhận rõ từng khoản; danh sách ngắn, tổng tiền và khoản còn thiếu đọc ngay, giảm trang trí.

Impeccable concept-seed đã chọn hướng số 5; seed reference và hồ sơ lựa chọn sẽ lưu cùng bản trình duyệt. Hướng dẫn đường là phương án thay thế. Các challenger chỉ được giữ nếu cải thiện cả nhận diện của khách lẫn độ rõ của tác vụ; không mang mô phỏng terminal/cockpit vào app.

## Ranh giới nghiệm thu

Canvas chứng minh luồng và nhận diện, không chứng minh app native đã triển khai. Sau duyệt mới cập nhật DESIGN.md/token, triển khai Flutter và chụp emulator/device với light/dark, font scale và back gesture. Không coi kiểm tra HTML/canvas là kiểm thử Android/iOS.
