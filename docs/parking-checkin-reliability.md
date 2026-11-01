# Check-in và lượt quét staff

Nhánh `fix/parking-checkin-reliability` dựa trên `main`.

## Thay đổi

- Xe máy, xe máy điện và xe đạp dùng sức chứa khu đỗ tự do, không nhận ô đánh số. Cổng phải thuộc tầng xe máy và đúng khu khách vãng lai/cư dân.
- Sức chứa được khóa và kiểm tra lại trong transaction. Biển số được khóa theo transaction để không tạo hai phiên đang hoạt động tại hai cổng khác nhau.
- Ô tô chỉ nhận ô đúng loại xe trong cùng bãi. Giữ ô bằng cập nhật có điều kiện; giữ ô, dùng mã vào bãi/cập nhật đặt chỗ và tạo phiên cùng transaction. Nếu một bước thất bại thì rollback.
- Vé tháng cố định dùng ô đã gán của khách tại đúng bãi. Gói mọi bãi nhận ô cư dân còn trống tại bãi hiện tại.
- API tình trạng chỗ trống theo tầng được tính thống nhất với sức chứa xe máy của danh sách bãi.
- `GateScan` chống trùng bằng nhân viên + cổng + thời gian chụp gốc + nội dung ảnh. Lần gửi lại trả HTTP 200 cùng `scanId`; không phát thêm sự kiện `scan`. Ảnh hoặc giờ chụp khác là lượt mới.
- UUID trong `PbmsBodyDto` (camelCase/PascalCase), path catalog/parking/entry-pass/gate-scan và query lọc cổng/loại xe được kiểm tra trước Prisma. Field optional trống trong body vẫn được chuyển cho service xử lý như trước.

## Migration cần áp dụng khi triển khai

Chạy `npx prisma migrate deploy` trên môi trường đã xác định trước khi chạy code mới. Migration `20261101000000_gate_scan_deduplication` thêm cột nullable và unique index trên `gate_scans.deduplication_key`; các bản ghi cũ được giữ nguyên.

Không có migration nào được chạy trên database của ứng dụng trong phiên làm việc này. Việc kiểm tra chỉ dùng một PostgreSQL tạm ở localhost, tách riêng khỏi PostgreSQL đang chạy sẵn.

## Kết quả kiểm tra

Đã chạy thành công 26 test case mới với PostgreSQL thật ở máy local, sau đó xóa file test theo yêu cầu. Các mock trong test có sẵn được cập nhật cho truy vấn mới.

Sau khi xóa test mới: toàn bộ 183 test có sẵn (34 suite) chạy thành công; lint không có lỗi (còn 2 cảnh báo import không dùng có sẵn); build thành công.

| Nhóm | Ca đã xác nhận |
| --- | --- |
| Xe máy | Không cần ô đỗ; giảm/tăng chỗ trống theo phiên; hết sức chứa/không có sức chứa; sai khu |
| Đồng thời | Hai xe tranh chỗ cuối; hai ô tô tranh cùng ô; cùng biển số tại hai cổng |
| Đúng bãi | Không dùng ô bãi khác; có thể dùng tầng khác trong cùng bãi |
| Mã vào bãi | Hai lần quét chỉ tạo một phiên; hết hạn giữa chừng trả lại ô đã giữ |
| Vé tháng/đặt chỗ | Khu xe máy, ô cư dân cố định, gói mọi bãi, check-in đặt trước |
| Lượt quét | Gửi lại tuần tự/đồng thời; một bản ghi và một sự kiện; khác ảnh/giờ tạo lượt mới |
| UUID | CamelCase/PascalCase, path sai định dạng, query optional |

Lịch sử migration cũ hiện tạo `roles.id` dạng smallint trong khi schema hiện tại khai báo UUID. Đây là độ lệch có sẵn; test dữ liệu người dùng dùng schema hiện tại trên database tạm. Migration mới đã được chạy riêng và xác nhận thành công trên schema đó. Nhánh này không thay đổi kiểu role của database đang sử dụng.

Khách không gửi `capturedAt` hợp lệ vẫn được hỗ trợ nhưng không có khóa chống trùng. Hai request trùng đến đồng thời có thể cùng lưu ảnh/nhận diện trước khi unique index chọn một bản ghi. Không gọi dịch vụ nhận diện hay thanh toán thật trong test.
