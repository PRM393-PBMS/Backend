# Review nháp Prisma (PBMS → PostgreSQL)

**Đã chốt (user):** hành vi/path/I/O theo hợp đồng freeze; runtime **chỉ PostgreSQL + Node/Nest**. Không SQL Server, **không** cần dump SQL Server. Schema Postgres bắt đầu trống; seed role tối thiểu cho `/api/Auth` (tên `"User"`).

Schema: `prisma/schema.prisma` (Prisma 6.4.1, `provider = "prisma-client-js"`).  
Path HTTP đóng băng: [`openapi-pbms-paths.md`](./openapi-pbms-paths.md).

Tên bảng/cột PostgreSQL theo convention Nest (**snake_case**, `@@map`) — **không** copy tên cột SQL Server `UserID` / `FloorID`.

`datetime` / thời điểm UTC → `Timestamptz(6)` **UTC** trên Postgres.

Tiền: `decimal(15, 2)` PBMS → `@db.Decimal(15, 2)`.

GUID → `@db.Uuid` + `@default(uuid())`.

---

## Status: String, không Prisma enum

Entity PBMS khai báo `string Status` (varchar + default). Enum nằm ở `Common/Enums` và `.ToString()` trong BLL. Prisma dùng **String + comment** (đúng varchar EF). Schema trống trên Postgres: ghi đúng `.ToString()` của enum PBMS khi insert.

| Enum PBMS | Giá trị quan sát |
|---------|------------------|
| `UserStatus` | Active, Inactive, Banned |
| `ParkingSlotStatus` | Available, Occupied, Assigned, Maintenance, Locked |
| `PricingPolicyStatus` | Active, Inactive |
| `PackageStatus` | Active, Inactive, Suspended |
| `MonthlySubscriptionStatus` | PendingPayment, Active, Cancelled, Expired |
| `VehicleChangeStatusEnum` | Pending, Approved, Rejected |
| `ReservationStatus` | Pending, Confirmed, Modified, CheckedIn, Completed, Cancelled, NoShow |
| `SessionStatus` | Active, Completed, Exception |
| `PaymentMethod` | PayOS, Cash |
| `PaymentType` | Deposit, CheckoutFee, SubscriptionFee, SubscriptionRenewal |
| `PaymentStatus` | Pending, Success, Failed |
| `IncidentStatus` | Open, InProgress, Resolved, Cancelled |

`Gate.GateType` là varchar(10), **không** có enum EF.

`UserRole` Prisma (`USER` / `ADMIN` / `MODERATOR`) **giữ** trên model User. PBMS dùng bảng `Role.roleName`.

---

## User Nest: additive vs phá

Giữ nguyên field Nest: `id`, `email`, `passwordHash`, `firstName`, `lastName`, `role` (`UserRole`), `isActive`, `isEmailVerified`, `createdAt`, `updatedAt`, quan hệ `refreshTokens`.

**Không** đổi tên `passwordHash` → `password`. PBMS `User.Password` map cùng cột hash.

| Thay đổi | Loại | Ghi chú |
|----------|------|---------|
| `userName` unique nullable | Additive | PBMS bắt buộc unique. Null cho user Nest cũ. |
| `fullName` nullable | Additive | PBMS bắt buộc. Giữ `firstName`/`lastName`. |
| `phoneNumber` unique nullable | Additive | PBMS EF `IsRequired` + unique; DTO `CreateUserDTO.PhoneNumber` lại `string?`. |
| `status` varchar nullable default `Active` | Additive | PBMS `User.Status`. **Không** xóa `isActive`. Đồng bộ: Active↔true; Inactive/Banned↔false. |
| `pbmsRoleId` FK `Role` nullable | Additive | PBMS `RoleId` bắt buộc. Null cho user Nest cho đến khi seed Role. |
| Bảng `Role` mới | Additive | |
| Quan hệ parking/payment/incident | Additive | |

**Không xóa / không rename** field Nest. Đăng ký PBMS OTP ghi `userName` / `fullName` / `email` / `phoneNumber` / `pbmsRoleId`.

Migration `20260917032600_pbms_domain` được áp dụng vào PostgreSQL trỏ bởi `DATABASE_URL`. Với Supabase, local và Render dùng Session Pooler URL có `sslmode=require`. Client Prisma generate lại sau migrate. Đăng ký PBMS OTP gán `userName`/`pbmsRoleId`.

RefreshToken Nest **giữ** `tokenHash`, `deviceInfo`, `ipAddress`, `expiresAt`, `updatedAt`, `onDelete: Cascade`. PBMS không có `ExpiresAt` / device / IP; lưu plaintext unique `RefreshTokenKey` varchar(500); FK `ClientSetNull`. **Không** thêm cột plaintext.

---

## Map entity / field

### User (`DAL/Models/User.cs` + EF)

| PBMS | SQL Server (EF) | Prisma | Postgres |
|----|-----------------|--------|----------|
| UserId | uniqueidentifier, newid, UserID | `id` | uuid PK |
| Email | varchar(100) unique, **không** IsRequired | `email` | varchar(255) unique **required** (giữ Nest; rộng hơn PBMS) |
| Password | varchar(255) required | `passwordHash` | varchar(255) |
| UserName | varchar(50) unique required | `userName` | varchar(50) unique nullable |
| FullName | nvarchar(100) required | `fullName` | varchar(100) nullable |
| PhoneNumber | varchar(15) unique required | `phoneNumber` | varchar(15) unique nullable |
| RoleId | uniqueidentifier required | `pbmsRoleId` | uuid nullable FK |
| Status | varchar(20) default Active | `status` | varchar(20) nullable default Active |
| CreatedAt / UpdatedAt | datetime | `createdAt` / `updatedAt` | timestamptz |
| — | — | `firstName`, `lastName`, `role`, `isActive`, `isEmailVerified` | Nest dual-surface |

### Role

| PBMS | EF | Prisma |
|----|----|--------|
| RoleId | uniqueidentifier RoleID | `id` uuid |
| RoleName | nvarchar(50) unique required | `roleName` unique varchar(50) |
| Description | nvarchar(255) | `description` nullable |

### RefreshToken

| PBMS | EF | Prisma |
|----|----|--------|
| RefreshTokenId | uniqueidentifier | `id` |
| UserId | uniqueidentifier | `userId` Cascade (Nest; PBMS ClientSetNull) |
| RefreshTokenKey | varchar(500) unique plaintext | **không map** — dùng `tokenHash` bcrypt |
| IsRevoked | bit default false, nullable PBMS | `isRevoked` Boolean required |
| CreatedAt | datetime getdate | `createdAt` timestamptz |
| — | không có | `expiresAt`, `deviceInfo`, `ipAddress`, `updatedAt` (Nest) |

### VehicleType

| PBMS | EF | Prisma |
|----|----|--------|
| VehicleTypeId | uniqueidentifier | `id` |
| TypeName | nvarchar(50) unique required | `typeName` unique |
| Dimensions | varchar(50) | `dimensions` nullable |

### Floor

| PBMS | EF | Prisma |
|----|----|--------|
| FloorId | uniqueidentifier | `id` |
| FloorName | nvarchar(50) unique required | `floorName` unique |
| DedicatedVehicleTypeId | uniqueidentifier nullable | `dedicatedVehicleTypeId` SetNull |
| TotalCapacity | int (không config EF thêm) | `totalCapacity` Int |
| IsResident | bool | `isResident` Boolean default false |

### Gate

| PBMS | EF | Prisma |
|----|----|--------|
| GateId | uniqueidentifier | `id` |
| GateName | nvarchar(50) required | `gateName` |
| GateType | varchar(10) required | `gateType` |
| FloorId | uniqueidentifier, ClientSetNull | `floorId` Restrict |

### ParkingSlot

| PBMS | EF | Prisma |
|----|----|--------|
| SlotId | uniqueidentifier SlotID | `id` |
| FloorId | uniqueidentifier | `floorId` Restrict |
| SlotCode | varchar(15) unique required | `slotCode` unique |
| VehicleTypeId | uniqueidentifier | `vehicleTypeId` Restrict |
| Status | varchar(20) default Available | `status` |
| AssignedUserId | uniqueidentifier nullable | `assignedUserId` SetNull |

### PricingPolicy

| PBMS | EF | Prisma |
|----|----|--------|
| PolicyId | uniqueidentifier | `id` |
| VehicleTypeId | uniqueidentifier | `vehicleTypeId` Restrict |
| BasePrice / ExtraHourPrice / NightSurcharge | decimal(15,2); Night default 0 | Decimal(15,2) |
| BaseHours | int | `baseHours` |
| EffectiveDate | datetime | timestamptz |
| Status | varchar(10) default Active | `status` |

### SubscriptionPackage

| PBMS | EF | Prisma |
|----|----|--------|
| PackageId | uniqueidentifier | `id` |
| PackageName | nvarchar(100) required | `packageName` |
| VehicleTypeId | uniqueidentifier | `vehicleTypeId` Restrict |
| DurationMonths | int | `durationMonths` |
| Price | decimal(15,2) | Decimal(15,2) |
| RequireFixedSlot | bit default false, nullable PBMS | Boolean default false |
| Description | nvarchar(500) | varchar(500) nullable |
| Status | varchar(10) default Active | `status` |

### MonthlySubscription

| PBMS | EF | Prisma |
|----|----|--------|
| SubscriptionId | uniqueidentifier | `id` |
| UserId / VehicleTypeId / PackageId | uniqueidentifier ClientSetNull | Restrict |
| LicensePlate | varchar(15) required | varchar(15) |
| StartDate / EndDate | datetime | timestamptz |
| Price | decimal(15,2) | Decimal(15,2) |
| FixedSlotId | uniqueidentifier nullable | SetNull |
| Status | varchar(30) default Active | `status` |

### SubscriptionRenewal

| PBMS | EF | Prisma |
|----|----|--------|
| RenewalId | uniqueidentifier | `id` |
| SubscriptionId | uniqueidentifier ClientSetNull | Restrict |
| OldEndDate / NewEndDate | datetime | timestamptz |
| Amount | decimal(15,2) | Decimal(15,2) |
| RenewalDate | datetime getdate nullable | timestamptz nullable default now |

### VehicleChangeRequest

| PBMS | EF | Prisma |
|----|----|--------|
| RequestId | uniqueidentifier | `id` |
| SubscriptionId | uniqueidentifier | Restrict |
| Old/New LicensePlate | varchar(15) required | varchar(15) |
| Reason / RejectionReason | nvarchar(500) | varchar(500) nullable |
| Status | varchar(15) default Pending | `status` |
| CreatedAt | datetime getdate nullable | timestamptz |
| ProcessedAt | datetime nullable | timestamptz |
| HandledByStaffId | uniqueidentifier nullable | SetNull |

### Reservation

| PBMS | EF | Prisma |
|----|----|--------|
| ReservationId | uniqueidentifier | `id` |
| UserId / VehicleTypeId | uniqueidentifier ClientSetNull | Restrict |
| ExpectedEntryTime | datetime | timestamptz |
| Status | varchar(15) default Pending | `status` |
| CreatedAt | datetime getdate nullable | timestamptz |

### ParkingSession

| PBMS | EF | Prisma |
|----|----|--------|
| SessionId | uniqueidentifier | `id` |
| ReservationId / DriverUserId | uniqueidentifier nullable | SetNull |
| LicensePlateIn | varchar(15) required | varchar(15) |
| LicensePlateOut | varchar(15) nullable | nullable |
| *ImageUrl (4) | varchar(max) unicode false | `String?` (text) |
| VehicleTypeId / EntryGateId | required ClientSetNull | Restrict |
| ExitGateId / AssignedSlotId / ActualSlotId | nullable | SetNull |
| EntryTime / ExitTime | datetime | timestamptz |
| Status | varchar(15) default Active | `status` |

### Payment

| PBMS | EF | Prisma |
|----|----|--------|
| PaymentId | uniqueidentifier | `id` |
| UserId / SessionId / ReservationId / SubscriptionId | nullable FKs | SetNull |
| Amount | decimal(15,2) | Decimal(15,2) |
| PaymentMethod | varchar(20) required | varchar(20) |
| PaymentType | varchar(30) nullable | nullable |
| PaymentTime | datetime | timestamptz |
| PaymentStatus | varchar(10) default Pending | `status` map `payment_status` |
| TransactionReference | varchar(100) nullable | varchar(100); index (PBMS không unique) |

### IncidentReport

| PBMS | EF | Prisma |
|----|----|--------|
| IncidentId | uniqueidentifier | `id` |
| SessionId | nullable | SetNull |
| ReportedByUserId | required ClientSetNull | Restrict |
| IssueType | nvarchar(255) required | varchar(255) |
| Description | required nvarchar(max) | `String` |
| ProofImageUrl | varchar(max) | `String?` |
| Status | varchar(15) default Open | `status` |
| HandledByStaffId | nullable | SetNull |
| ResolvedAt | datetime nullable | timestamptz |
| ResolutionNotes | string (không max EF) | `String?` |

Unique EF đã đưa vào Prisma: `Floor.floorName`, `ParkingSlot.slotCode`, `Role.roleName`, `VehicleType.typeName`, `User.email`, `User.userName`, `User.phoneNumber`.  
PBMS `RefreshToken.RefreshTokenKey` unique **không** port (plaintext).

---

## Câu hỏi đã đóng — follow PBMS trên PostgreSQL

Không dump SQL Server. Schema trống; không bịa rule mới.

1. **`isActive` vs `status`:** PBMS `AuthService` dùng `Status == Active` / `== Banned`. Trên Postgres: `status` là nguồn PBMS. Đồng bộ Nest: `Active` → `isActive=true`; `Inactive` hoặc `Banned` → `isActive=false`. Login `/api/Auth`: Banned → message khóa 403; khác Active → message vô hiệu hóa 403 (đúng PBMS).
2. **Email:** `/api/Auth` bắt buộc email (PBMS service). Cột Nest `email` required. Không còn câu hỏi dump null.
3. **Phone:** `/api/Auth/send-register-otp` bắt buộc phone + regex PBMS. Unique Postgres cho phép nhiều `NULL` (user Nest). Không lưu `""`.
4. **`pbmsRoleId`:** User PBMS OTP gán Role tên `"User"` (PBMS). Seed role: `User`, `Customer`, `Staff`, `Manager`, `Admin` (đúng chuỗi `[Authorize]` / `GetRoleByNameAsync`).
5. **Timezone:** ghi `timestamptz` UTC. Job NoShow sau này tính UTC.
6. **`Gate.GateType`:** varchar(10), không enum — đúng EF.
7. **`TransactionReference`:** index, không unique — đúng PBMS.
8. **Độ dài status:** giữ maxlength EF; String nhận `.ToString()` enum PBMS.
9. **Role JWT `/api`:** claim `role` = `Role.roleName` (User/Manager/…). Enum Prisma `USER`/`ADMIN`/`MODERATOR` vẫn trên cột `users.role`. HTTP lệch khoảng trắng trong attribute: so khớp role **không phân biệt hoa thường**; seed dùng `User`, `Customer`, `Staff`, `Manager`, `Admin`.
10. **Xóa user:** Nest RT `onDelete: Cascade` (giữ). FK nghiệp vụ Restrict/SetNull. `DELETE /api/User/{id}` (pha sau) follow PBMS `UserService.Delete` khi implement, không đổi schema lúc này.

---

## Việc đã / chưa làm

- **Đã migrate** Postgres: `20260917032600_pbms_domain` (schema trống + seed role User/Customer/Staff/Manager/Admin). Không SQL Server dump. Local CLI và Render dùng Supabase Session Pooler URL với `sslmode=require`.
- Pha 1: envelope `PbmsResponseDto` + `/api/Auth/*` (login, OTP register/reset, refresh, logout). Surface Nest `/auth/*` đã gỡ khỏi HTTP công khai.
- Module bãi đỗ / PayOS / OCR: chưa.
