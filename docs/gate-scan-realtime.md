# Quét biển số bằng điện thoại → web staff (real-time)

Điện thoại của nhân viên chỉ là máy quét: chọn cổng, chụp biển số, gửi lên máy chủ.
Máy chủ lưu ảnh, nhận diện biển số, đối chiếu dữ liệu rồi đẩy sự kiện cho web staff đang mở đúng cổng.
Mọi xử lý (đối chiếu, check-in mở cổng, checkout) vẫn làm trên web như hiện nay.

```
App staff ──POST /api/GateScan (ảnh, gateId, capturedAt)──▶ Backend ──SSE event "scan"──▶ Web staff (ScanPlate)
                                                              │
                                    lưu ảnh + Plate Recognizer + tra đặt chỗ / gói tháng / phiên đang mở
```

Mọi endpoint cần JWT của tài khoản `staff` hoặc `manager`.

## 1. Điện thoại gửi lượt quét

`POST /api/GateScan` — `multipart/form-data`

| Field | Bắt buộc | Ghi chú |
|---|---|---|
| `file` | có | JPEG / PNG / WebP, tối đa 8MB |
| `gateId` | có | Cổng nhân viên đang đứng |
| `capturedAt` | không | Giờ chụp ISO 8601. Lệch giờ máy chủ quá 10 phút thì máy chủ dùng giờ của nó |

Nhân viên quét lấy từ token. Không đọc được biển số vẫn lưu và phát sự kiện (`licensePlate: null`) để web nhập tay.

## 2. Web nhận real-time

`GET /api/GateScan/stream?gateId=<id>` — Server-Sent Events (`text/event-stream`).
Bỏ `gateId` để nhận mọi cổng.

| Sự kiện | Khi nào | `data` |
|---|---|---|
| `scan` | Có lượt quét mới | `GateScanDto` |
| `scan-updated` | Lượt quét đổi trạng thái | `GateScanDto` |
| `ping` | Mỗi 25 giây, giữ kết nối | `{ at }` |

`EventSource` của trình duyệt không gửi được header `Authorization`, nên đọc bằng `fetch`:

```ts
export function subscribeGateScans(
  gateId: string,
  token: string,
  onScan: (scan: GateScanDto, type: 'scan' | 'scan-updated') => void,
): () => void {
  const controller = new AbortController();

  const run = async () => {
    while (!controller.signal.aborted) {
      try {
        const res = await fetch(`${API_BASE_URL}/api/GateScan/stream?gateId=${gateId}`, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
          signal: controller.signal,
        });
        if (!res.ok || !res.body) throw new Error(`SSE ${res.status}`);
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value;
          let end: number;
          while ((end = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            const type = /^event: (.*)$/m.exec(block)?.[1];
            const data = /^data: (.*)$/m.exec(block)?.[1];
            if ((type === 'scan' || type === 'scan-updated') && data) onScan(JSON.parse(data), type);
          }
        }
      } catch {
        if (controller.signal.aborted) return;
      }
      // Mất kết nối (deploy lại, mạng chập chờn): thử lại sau 3 giây.
      await new Promise((r) => setTimeout(r, 3000));
    }
  };
  void run();
  return () => controller.abort();
}
```

Sau khi kết nối lại, gọi `GET /api/GateScan/recent?gateId=<id>` để lấy các lượt quét bị lỡ.

## 3. `GateScanDto`

```jsonc
{
  "scanId": "uuid",
  "gateId": "uuid", "gateName": "Cổng A", "gateType": "Entry", "floorName": "Tầng B1",
  "imageUrl": "https://.../uploads/gate-scans/<file>.jpg",
  "licensePlate": "51H12345",          // null nếu không đọc được
  "confidence": 0.91,
  "capturedAt": "2026-10-27T08:15:02.000Z",   // giờ chụp trên điện thoại
  "receivedAt": "2026-10-27T08:15:03.120Z",   // giờ máy chủ nhận
  "scannedBy": { "userId": "uuid", "fullName": "Nguyễn Văn A" },
  "suggestedType": "Reservation",      // xem bảng dưới
  "reservationId": "uuid",             // đặt chỗ gần giờ quét nhất, nếu có
  "match": {
    "reservation": {
      "reservationId": "uuid", "status": "Confirmed",
      "expectedEntryTime": "2026-10-27T08:30:00.000Z",
      "onTime": true,                  // trong ±30 phút quanh giờ hẹn (điều kiện check-in đặt chỗ)
      "customerName": "Trần B", "phoneNumber": "0901...", "vehicleTypeName": "Ô tô"
    },
    "subscription": { "subscriptionId": "uuid", "packageName": "Gói tháng ô tô", "endDate": "..." },
    "activeSession": { "sessionId": "uuid", "entryTime": "...", "entryGateName": "Cổng A" },
    "vehicle": { "vehicleTypeId": "uuid", "vehicleTypeName": "Ô tô", "ownerName": "Trần B" }
  },                                   // null nếu không đọc được biển số
  "status": "New",                     // New | Handled | Dismissed
  "handledAt": null
}
```

`suggestedType` chỉ là gợi ý, nhân viên web quyết định:

| Giá trị | Ý nghĩa | Web nên làm |
|---|---|---|
| `Reservation` | Có đặt chỗ Confirmed/Modified trong ±12 giờ | Điền `reservationId`, kiểm `onTime`, check-in `customerType: Reservation` |
| `Resident` | Có gói tháng hiệu lực tại bãi | Check-in `Resident` |
| `Guest` | Không có đặt chỗ / gói tháng | Chọn loại xe (gợi ý `match.vehicle`), check-in `Guest` |
| `Inside` | Biển số đang có phiên Active | Cảnh báo: xe đã trong bãi |
| `Checkout` | Cổng ra, có phiên đang mở | Mở checkout với `match.activeSession.sessionId` |
| `Unknown` | Không đọc được biển số, hoặc cổng ra mà không có phiên | Xem ảnh, nhập tay |

## 4. Đánh dấu đã xử lý

`PATCH /api/GateScan/:id/status` body `{ "status": "Handled" | "Dismissed" | "New" }`.
Web gọi sau khi check-in/checkout xong (`Handled`) hoặc bỏ qua ảnh hỏng (`Dismissed`).
Mọi web đang mở cổng đó nhận `scan-updated` để ẩn thẻ.

## 5. Danh sách gần đây

`GET /api/GateScan/recent?gateId=&mine=true&limit=20` — mới nhất trước. App điện thoại dùng `mine=true`.

## Giới hạn

- Kênh phát nằm trong bộ nhớ của một tiến trình. Chạy nhiều instance thì cần Redis pub/sub.
- Ảnh lưu trên đĩa máy chủ (`/uploads/gate-scans/`), Render xoá khi deploy lại.
- Cần chạy migration `20261027000000_gate_scans` trước khi dùng.
