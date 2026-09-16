# Hợp đồng path PBMS (`/api/*`) — ĐÓNG BĂNG

Danh sách **mọi** HTTP action của surface PBMS trên backend Node.  
Path giữ **đúng casing** đã freeze (ví dụ `/api/Auth`, `/api/reservations`).

**Trạng thái: FROZEN** — đây là surface Nest phải expose cho client PBMS.  
HTTP công khai chỉ còn `/api/*`. Không còn route Nest `/auth/*`.

Quy ước cột:

- **Auth:** Anonymous = không JWT. JWT = đã đăng nhập. Roles = chuỗi nguyên văn (kể cả khoảng trắng / hoa thường lệch).
- **Request:** tên DTO hoặc query/file/body đặc biệt.
- **Response:** envelope `{ statusCode, message, isSuccess, result }` và HTTP status = `statusCode`, trừ khi ghi khác.

Tổng: **126** action.

---

## Auth — `/api/Auth`

Route class: `api/[controller]` → **`/api/Auth`**. Không `[Authorize]` class.

| Method | Path | Auth | Request | Response | Controller |
|--------|------|------|---------|----------|------------|
| POST | `/api/Auth/login` | Anonymous | `AuthDTO.LoginDTO` | `ResponseDTO` (`result`: user + accessToken + refreshToken) | AuthController |
| POST | `/api/Auth/send-register-otp` | Anonymous | `AuthDTO.RegisterDTO` | `ResponseDTO` | AuthController |
| POST | `/api/Auth/verify-register-otp` | Anonymous | `AuthDTO.VerifyRegisterOtpDTO` | `ResponseDTO` (`result`: `{ userId }`) | AuthController |
| POST | `/api/Auth/request-reset-password` | Anonymous | `AuthDTO.RequestOtpDTO` | `ResponseDTO` | AuthController |
| POST | `/api/Auth/verify-reset-password` | Anonymous | `AuthDTO.VerifyResetPasswordOtpDTO` | `ResponseDTO` | AuthController |
| POST | `/api/Auth/refresh-token` | Anonymous | `RefreshTokenDTO` (`refreshTokenKey`) | `ResponseDTO` | AuthController |
| POST | `/api/Auth/logout` | Anonymous | `RefreshTokenDTO` | `ResponseDTO`; 400/`BadRequest`; fail → 500; success `Ok` | AuthController |

**7**

---

## User admin — `UserController`

Route: `/api/User`. Class: `[Authorize(Roles = "Admin,Manager")]`.

| Method | Path | Auth | Request | Response | Controller |
|--------|------|------|---------|----------|------------|
| GET | `/api/User/all` | JWT Admin,Manager | — | `ResponseDTO` | UserController |
| GET | `/api/User/roles` | JWT Admin,Manager | — | `ResponseDTO` | UserController |
| GET | `/api/User/{id}` | JWT Admin,Manager | path `guid` | `ResponseDTO` | UserController |
| POST | `/api/User/create` | JWT Admin,Manager | `CreateUserDTO` | `ResponseDTO` | UserController |
| PUT | `/api/User/update` | JWT Admin,Manager | `UpdateUserDTO` | `ResponseDTO` | UserController |
| PATCH | `/api/User/{id}/status` | JWT Admin,Manager | `UpdateUserStatusDTO` | `ResponseDTO` | UserController |
| DELETE | `/api/User/{id}` | JWT Admin,Manager | path `guid` | `ResponseDTO` | UserController |

**7**

---

## Role — `RoleController`

Route: `/api/Role`. Class: `[Authorize(Roles = "Admin,admin")]`.

| Method | Path | Auth | Request | Response | Controller |
|--------|------|------|---------|----------|------------|
| GET | `/api/Role` | JWT Admin,admin | — | `ResponseDTO` | RoleController |
| GET | `/api/Role/{id}` | JWT Admin,admin | path `guid` | `ResponseDTO` | RoleController |
| POST | `/api/Role` | JWT Admin,admin | `CreateRoleDTO` | `ResponseDTO` | RoleController |
| PUT | `/api/Role` | JWT Admin,admin | `UpdateRoleDTO` | `ResponseDTO` | RoleController |
| DELETE | `/api/Role/{id}` | JWT Admin,admin | path `guid` | `ResponseDTO` | RoleController |

**5**

---

## Profile — `ProfileController`

Route: **`/api/profile`** (lowercase cố định). Class: `[Authorize]`.

| Method | Path | Auth | Request | Response | Controller |
|--------|------|------|---------|----------|------------|
| GET | `/api/profile` | JWT | — | `ResponseDTO` | ProfileController |
| PUT | `/api/profile` | JWT | `UpdateProfileDTO` | `ResponseDTO` | ProfileController |

**2**

---

## VehicleType — `VehicleTypeController`

Route: `/api/VehicleType`. Class: `[Authorize(Roles = "Manager, Staff")]`. Mutate: Manager.

| Method | Path | Auth | Request | Response | Controller |
|--------|------|------|---------|----------|------------|
| GET | `/api/VehicleType` | JWT Manager, Staff | — | `ResponseDTO` | VehicleTypeController |
| GET | `/api/VehicleType/{id}` | JWT Manager, Staff | path `guid` | `ResponseDTO` | VehicleTypeController |
| POST | `/api/VehicleType` | JWT Manager | `CreateVehicleTypeDTO` | `ResponseDTO` | VehicleTypeController |
| PUT | `/api/VehicleType` | JWT Manager | `UpdateVehicleTypeDTO` | `ResponseDTO` | VehicleTypeController |
| DELETE | `/api/VehicleType/{id}` | JWT Manager | path `guid` | `ResponseDTO` | VehicleTypeController |

**5**

---

## Floor — `FloorController`

Route: `/api/Floor`. GET **không** `[Authorize]` (Anonymous). Mutate Manager.

| Method | Path | Auth | Request | Response | Controller |
|--------|------|------|---------|----------|------------|
| GET | `/api/Floor` | Anonymous | — | `ResponseDTO` | FloorController |
| GET | `/api/Floor/{id}` | Anonymous | path `guid` | `ResponseDTO` | FloorController |
| POST | `/api/Floor` | JWT Manager | `CreateFloorDTO` | `ResponseDTO` | FloorController |
| PUT | `/api/Floor` | JWT Manager | `UpdateFloorDTO` | `ResponseDTO` | FloorController |
| DELETE | `/api/Floor/{id}` | JWT Manager | path `guid` | `ResponseDTO` | FloorController |

**5**

---

## Gate — `GateController`

Route: `/api/Gate`. GET Anonymous. Mutate Manager.

| Method | Path | Auth | Request | Response | Controller |
|--------|------|------|---------|----------|------------|
| GET | `/api/Gate` | Anonymous | — | `ResponseDTO` | GateController |
| GET | `/api/Gate/{id}` | Anonymous | path `guid` | `ResponseDTO` | GateController |
| POST | `/api/Gate` | JWT Manager | `CreateGateDTO` | `ResponseDTO` | GateController |
| PUT | `/api/Gate` | JWT Manager | `UpdateGateDTO` | `ResponseDTO` | GateController |
| DELETE | `/api/Gate/{id}` | JWT Manager | path `guid` | `ResponseDTO` | GateController |

**5**

---

## ParkingSlot — `ParkingSlotController`

Route: `/api/ParkingSlot`. GET Anonymous.

| Method | Path | Auth | Request | Response | Controller |
|--------|------|------|---------|----------|------------|
| GET | `/api/ParkingSlot` | Anonymous | — | `ResponseDTO` | ParkingSlotController |
| GET | `/api/ParkingSlot/{id}` | Anonymous | path `guid` | `ResponseDTO` | ParkingSlotController |
| POST | `/api/ParkingSlot` | JWT Manager | `CreateParkingSlotDTO` | `ResponseDTO` | ParkingSlotController |
| PUT | `/api/ParkingSlot` | JWT Manager | `UpdateParkingSlotDTO` | `ResponseDTO` | ParkingSlotController |
| PATCH | `/api/ParkingSlot/{id}/status` | JWT Manager, Staff | `UpdateParkingSlotStatusDTO` | `ResponseDTO` | ParkingSlotController |
| DELETE | `/api/ParkingSlot/{id}` | JWT Manager | path `guid` | `ResponseDTO` | ParkingSlotController |

**6**

---

## PricingPolicy — `PricingPolicyController`

Route: `/api/PricingPolicy`. GET Anonymous. Mutate Manager.

| Method | Path | Auth | Request | Response | Controller |
|--------|------|------|---------|----------|------------|
| GET | `/api/PricingPolicy` | Anonymous | — | `ResponseDTO` | PricingPolicyController |
| GET | `/api/PricingPolicy/{id}` | Anonymous | path `guid` | `ResponseDTO` | PricingPolicyController |
| POST | `/api/PricingPolicy` | JWT Manager | `CreatePricingPolicyDTO` | `ResponseDTO` | PricingPolicyController |
| PUT | `/api/PricingPolicy` | JWT Manager | `UpdatePricingPolicyDTO` | `ResponseDTO` | PricingPolicyController |
| DELETE | `/api/PricingPolicy/{id}` | JWT Manager | path `guid` | `ResponseDTO` | PricingPolicyController |

**5**

---

## SubscriptionPackage — `SubscriptionPackageController`

Route: `/api/SubscriptionPackage`. GET Anonymous. Mutate Manager.

| Method | Path | Auth | Request | Response | Controller |
|--------|------|------|---------|----------|------------|
| GET | `/api/SubscriptionPackage` | Anonymous | — | `ResponseDTO` | SubscriptionPackageController |
| GET | `/api/SubscriptionPackage/{id}` | Anonymous | path `guid` | `ResponseDTO` | SubscriptionPackageController |
| POST | `/api/SubscriptionPackage` | JWT Manager | `CreateSubscriptionPackageDTO` | `ResponseDTO` | SubscriptionPackageController |
| PUT | `/api/SubscriptionPackage/{id}` | JWT Manager | `UpdateSubscriptionPackageDTO` | `ResponseDTO` | SubscriptionPackageController |
| DELETE | `/api/SubscriptionPackage/{id}` | JWT Manager | path `guid` | `ResponseDTO` | SubscriptionPackageController |

**5**

---

## MonthlySubscription — `MonthlySubscriptionController`

Route: `/api/MonthlySubscription`. Class: `[Authorize]`.

| Method | Path | Auth | Request | Response | Controller |
|--------|------|------|---------|----------|------------|
| POST | `/api/MonthlySubscription/register` | JWT | `RegisterMonthlySubscriptionDTO` | `ResponseDTO` | MonthlySubscriptionController |
| POST | `/api/MonthlySubscription` | JWT Manager | `ManagerCreateMonthlySubscriptionDTO` | `ResponseDTO` | MonthlySubscriptionController |
| GET | `/api/MonthlySubscription` | JWT Manager | — | `ResponseDTO` | MonthlySubscriptionController |
| GET | `/api/MonthlySubscription/my` | JWT | — | `ResponseDTO` | MonthlySubscriptionController |
| GET | `/api/MonthlySubscription/user/{userId}` | JWT Manager | path `guid` | `ResponseDTO` | MonthlySubscriptionController |
| GET | `/api/MonthlySubscription/{id}` | JWT | path `guid` | `ResponseDTO` | MonthlySubscriptionController |
| PUT | `/api/MonthlySubscription/{id}` | JWT Manager | `UpdateMonthlySubscriptionDTO` | `ResponseDTO` | MonthlySubscriptionController |
| PUT | `/api/MonthlySubscription/{id}/cancel` | JWT | path `guid` | `ResponseDTO` | MonthlySubscriptionController |
| DELETE | `/api/MonthlySubscription/{id}` | JWT Manager | path `guid` | `ResponseDTO` | MonthlySubscriptionController |
| POST | `/api/MonthlySubscription/payment/{subscriptionId}` | JWT | path `guid` | `ResponseDTO` | MonthlySubscriptionController |

**10**

---

## SubscriptionRenewal — `SubscriptionRenewalController`

Route: `/api/SubscriptionRenewal`. Class: `[Authorize]`.

| Method | Path | Auth | Request | Response | Controller |
|--------|------|------|---------|----------|------------|
| POST | `/api/SubscriptionRenewal/{id}/renew` | JWT | `RenewSubscriptionDTO` | `ResponseDTO` | SubscriptionRenewalController |
| GET | `/api/SubscriptionRenewal/{id}/renewals` | JWT | path `guid` (subscription) | `ResponseDTO` | SubscriptionRenewalController |
| GET | `/api/SubscriptionRenewal` | JWT Manager | — | `ResponseDTO` | SubscriptionRenewalController |
| GET | `/api/SubscriptionRenewal/{id}` | JWT | path `guid` (renewal) | `ResponseDTO` | SubscriptionRenewalController |
| POST | `/api/SubscriptionRenewal/direct-renew` | JWT Manager | `CreateDirectRenewalDTO` | `ResponseDTO` | SubscriptionRenewalController |
| PUT | `/api/SubscriptionRenewal` | JWT Manager | `UpdateRenewalDTO` | `ResponseDTO` | SubscriptionRenewalController |
| DELETE | `/api/SubscriptionRenewal/{id}` | JWT Manager | path `guid` | `ResponseDTO` | SubscriptionRenewalController |

**7**

---

## VehicleChangeRequest — `VehicleChangeRequestController`

Route: `/api/VehicleChangeRequest`. Class: `[Authorize]`.

| Method | Path | Auth | Request | Response | Controller |
|--------|------|------|---------|----------|------------|
| POST | `/api/VehicleChangeRequest/change-vehicle` | JWT Customer,User | `CreateVehicleChangeDTO` | `ResponseDTO` | VehicleChangeRequestController |
| GET | `/api/VehicleChangeRequest/change-vehicle/{id}` | JWT | path `guid` | `ResponseDTO` | VehicleChangeRequestController |
| GET | `/api/VehicleChangeRequest/my-requests` | JWT Customer,User | — | `ResponseDTO` | VehicleChangeRequestController |
| GET | `/api/VehicleChangeRequest/change-vehicle` | JWT Manager | — | `ResponseDTO` | VehicleChangeRequestController |
| PUT | `/api/VehicleChangeRequest/change-vehicle/{id}/approve` | JWT Manager | path `guid` | `ResponseDTO` | VehicleChangeRequestController |
| PUT | `/api/VehicleChangeRequest/change-vehicle/{id}/reject` | JWT Manager | `RejectVehicleChangeDTO` | `ResponseDTO` | VehicleChangeRequestController |
| PUT | `/api/VehicleChangeRequest/change-vehicle/{id}` | JWT Customer,User | `UpdateVehicleChangeDTO` | `ResponseDTO` | VehicleChangeRequestController |
| DELETE | `/api/VehicleChangeRequest/change-vehicle/{id}` | JWT Customer,User | path `guid` | `ResponseDTO` | VehicleChangeRequestController |

**8**

---

## Reservation — `ReservationController`

Route cố định: **`/api/reservations`**. Class: `[Authorize]`.

| Method | Path | Auth | Request | Response | Controller |
|--------|------|------|---------|----------|------------|
| POST | `/api/reservations` | JWT | `CreateReservationDTO` | `ResponseDTO` (`CreateReservationPaymentDTO`) | ReservationController |
| PUT | `/api/reservations/{reservationId}/change-time` | JWT | body **`DateTime` thô** (`newExpectedTime`) | `ResponseDTO` | ReservationController |
| POST | `/api/reservations/{id}/recreate-payment` | JWT | path | `ResponseDTO` | ReservationController |
| GET | `/api/reservations/my-reservations` | JWT | — | `ResponseDTO` | ReservationController |
| GET | `/api/reservations/{reservationId}` | JWT | path | `ResponseDTO` | ReservationController |
| PUT | `/api/reservations/{reservationId}/cancel` | JWT | path | `ResponseDTO` | ReservationController |
| GET | `/api/reservations/check-payment-status/{orderCode}` | JWT | path string | `ResponseDTO` | ReservationController |
| GET | `/api/reservations` | JWT Manager,Staff | query `status`, `date` | `ResponseDTO` | ReservationController |
| PUT | `/api/reservations/{reservationId}/status` | JWT Manager,Staff | `UpdateReservationStatusDTO` | `ResponseDTO` | ReservationController |

**9**

---

## Payment — `PaymentController`

Route cố định: **`/api/payments`**.

| Method | Path | Auth | Request | Response | Controller |
|--------|------|------|---------|----------|------------|
| POST | `/api/payments/payos-webhook` | Anonymous | `PayOSWebhookDTO` | **200 body rỗng** (`Ok()`). Lỗi: 500 `{ statusCode, message, isSuccess }` **không** bọc `Result` | PaymentController |
| GET | `/api/payments` | JWT Manager | — | `ResponseDTO` | PaymentController |
| GET | `/api/payments/{id}` | JWT Manager | path `guid` | `ResponseDTO` | PaymentController |
| POST | `/api/payments` | JWT Manager | `CreatePaymentDTO` | `ResponseDTO` | PaymentController |
| PUT | `/api/payments` | JWT Manager | `UpdatePaymentDTO` | `ResponseDTO` | PaymentController |
| DELETE | `/api/payments/{id}` | JWT Manager | path `guid` | `ResponseDTO` | PaymentController |

**6**

---

## ParkingSession — `ParkingSessionController`

Route: `/api/ParkingSession`. Class: `[Authorize]`.

| Method | Path | Auth | Request | Response | Controller |
|--------|------|------|---------|----------|------------|
| GET | `/api/ParkingSession` | JWT Manager, Staff | — | `ResponseDTO` | ParkingSessionController |
| GET | `/api/ParkingSession/my` | JWT Customer, User | — | `ResponseDTO` | ParkingSessionController |
| GET | `/api/ParkingSession/my/{id}/fee-preview` | JWT Customer, User | path `guid` | `ResponseDTO` | ParkingSessionController |
| GET | `/api/ParkingSession/my/{id}/checkout-payment` | JWT Customer, User | path `guid` | `ResponseDTO` | ParkingSessionController |
| GET | `/api/ParkingSession/{id}` | JWT Manager, Staff | path `guid` | `ResponseDTO` | ParkingSessionController |
| POST | `/api/ParkingSession` | JWT Manager, Staff | `CreateParkingSessionDTO` | `ResponseDTO` | ParkingSessionController |
| PUT | `/api/ParkingSession` | JWT Manager, Staff | `UpdateParkingSessionDTO` | `ResponseDTO` | ParkingSessionController |
| DELETE | `/api/ParkingSession/{id}` | JWT Manager, Staff | path `guid` | `ResponseDTO` | ParkingSessionController |

**8**

---

## ParkingOperation — `ParkingOperationController`

Route: `/api/ParkingOperation`. Class: `[Authorize(Roles = "Staff, Manager")]`. `availability` AllowAnonymous.

| Method | Path | Auth | Request | Response | Controller |
|--------|------|------|---------|----------|------------|
| POST | `/api/ParkingOperation/upload-and-recognize-plate` | JWT Staff, Manager | `multipart/form-data` file | **Raw** `PlateRecognitionResultDTO` 200; không biển → **422** cùng DTO; lỗi upload `{ message }` | ParkingOperationController |
| POST | `/api/ParkingOperation/upload-and-decode-qr` | JWT Staff, Manager | multipart file | `ResponseDTO` | ParkingOperationController |
| POST | `/api/ParkingOperation/upload-image` | JWT Staff, Manager | multipart file | **Raw** `{ imageUrl }` | ParkingOperationController |
| POST | `/api/ParkingOperation/resolve-qr-payload` | JWT Staff, Manager | `ResolveQrPayloadDTO` | `ResponseDTO` | ParkingOperationController |
| POST | `/api/ParkingOperation/check-in` | JWT Staff, Manager | `ParkingCheckInDTO` | `ResponseDTO` | ParkingOperationController |
| POST | `/api/ParkingOperation/check-out` | JWT Staff, Manager | `ParkingCheckOutDTO` | `ResponseDTO` | ParkingOperationController |
| GET | `/api/ParkingOperation/check-out/payment/{paymentId}` | JWT Staff, Manager | path `guid` | `ResponseDTO` | ParkingOperationController |
| POST | `/api/ParkingOperation/check-out/payment/{paymentId}/confirm-cash` | JWT Staff, Manager | path `guid` | `ResponseDTO` | ParkingOperationController |
| POST | `/api/ParkingOperation/check-out/payment/{paymentId}/cancel` | JWT Staff, Manager | path `guid` | `ResponseDTO` | ParkingOperationController |
| GET | `/api/ParkingOperation/fee-preview/{sessionId}` | JWT Staff, Manager | path `guid` | `ResponseDTO` | ParkingOperationController |
| GET | `/api/ParkingOperation/availability` | Anonymous | query `vehicleTypeId`, `floorKeyword` | `ResponseDTO` | ParkingOperationController |

**11**

---

## IncidentReport — `IncidentReportController`

Route: `/api/IncidentReport`. Class: `[Authorize]`.

| Method | Path | Auth | Request | Response | Controller |
|--------|------|------|---------|----------|------------|
| GET | `/api/IncidentReport` | JWT Manager, Staff | — | `ResponseDTO` | IncidentReportController |
| GET | `/api/IncidentReport/{id}` | JWT | path `guid` | `ResponseDTO`; không phải chủ + không Manager/Staff → **`Forbid()` 403** (không envelope) | IncidentReportController |
| GET | `/api/IncidentReport/assignees` | JWT Manager | — | `ResponseDTO` | IncidentReportController |
| GET | `/api/IncidentReport/my-reports` | JWT | — | `ResponseDTO`; token không parse user → 401 `{ message }` | IncidentReportController |
| POST | `/api/IncidentReport` | JWT | `CreateIncidentReportDTO` | `ResponseDTO` | IncidentReportController |
| POST | `/api/IncidentReport/upload-proof` | JWT | multipart file | **Raw** `{ imageUrl }` hoặc `{ message }` 400 | IncidentReportController |
| PUT | `/api/IncidentReport` | JWT Manager | `UpdateIncidentReportDTO` | `ResponseDTO` | IncidentReportController |
| PUT | `/api/IncidentReport/{id}/assign/{staffId}` | JWT Staff,Manager | path 2 guid | `ResponseDTO` | IncidentReportController |
| PUT | `/api/IncidentReport/{id}/resolve/{staffId}` | JWT Staff,Manager | `ResolveIncidentDTO` | `ResponseDTO` | IncidentReportController |
| DELETE | `/api/IncidentReport/{id}` | JWT Manager | path `guid` | `ResponseDTO` | IncidentReportController |

**10**

---

## Report — `ReportController`

Route cố định: **`/api/reports`**. Class: `[Authorize(Roles = "Manager,manager,Admin,admin")]`.

| Method | Path | Auth | Request | Response | Controller |
|--------|------|------|---------|----------|------------|
| GET | `/api/reports/types` | JWT Manager,manager,Admin,admin | — | `ResponseDTO` | ReportController |
| GET | `/api/reports/summary` | JWT Manager,manager,Admin,admin | query `ReportFilterDTO` | `ResponseDTO` | ReportController |
| GET | `/api/reports/revenue` | JWT Manager,manager,Admin,admin | query `ReportFilterDTO` | `ResponseDTO` | ReportController |
| GET | `/api/reports/operations` | JWT Manager,manager,Admin,admin | query `ReportFilterDTO` | `ResponseDTO` | ReportController |
| GET | `/api/reports/export` | JWT Manager,manager,Admin,admin | query `ReportExportRequestDTO` | **File binary PDF** (`File(content, contentType, fileName)`); lỗi → `ResponseDTO` | ReportController |

**5**

---

## Ghi chú freeze

1. Không gộp path PascalCase (`/api/Auth`) với lowercase (`/api/reservations`, `/api/payments`, `/api/reports`, `/api/profile`) — client gọi đúng như trên.
2. Swagger Nest hiện tại `/api/docs` **không** đụng các path trên.
3. Job nền (NoShow / overdue) **không** phải HTTP — không nằm trong bảng này.
4. YAML OpenAPI đầy đủ schema **không** kèm theo lượt này (ưu tiên inventory path đủ 126).

Kiểm đếm: 7+7+5+2+5+5+5+6+5+5+10+7+8+9+6+8+11+10+5 = **126**.
