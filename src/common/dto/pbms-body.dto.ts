import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';
import { ids } from '../swagger/pbms-example-data';

/**
 * Body PBMS: giữ cả camelCase và PascalCase khi whitelist bật.
 * Không ép kiểu để client gửi string/number/boolean tùy endpoint.
 */
export class PbmsBodyDto {
  @ApiPropertyOptional({ type: String, format: 'uuid', example: ids.roleStaffId })
  @IsOptional()
  roleId?: unknown;
  @ApiPropertyOptional() @IsOptional() RoleId?: unknown;

  @ApiPropertyOptional({ type: String, example: 'staff' })
  @IsOptional()
  roleName?: unknown;
  @ApiPropertyOptional() @IsOptional() RoleName?: unknown;

  @ApiPropertyOptional({ type: String, example: 'Nhân viên vận hành bãi xe' })
  @IsOptional()
  description?: unknown;
  @ApiPropertyOptional() @IsOptional() Description?: unknown;

  @ApiPropertyOptional({ type: String, format: 'uuid', example: ids.vehicleTypeId })
  @IsOptional()
  vehicleTypeId?: unknown;
  @ApiPropertyOptional() @IsOptional() VehicleTypeId?: unknown;

  @ApiPropertyOptional({ type: String, example: 'Xe máy' })
  @IsOptional()
  typeName?: unknown;
  @ApiPropertyOptional() @IsOptional() TypeName?: unknown;

  @ApiPropertyOptional({ type: String, example: '2.0m x 0.8m' })
  @IsOptional()
  dimensions?: unknown;
  @ApiPropertyOptional() @IsOptional() Dimensions?: unknown;

  @ApiPropertyOptional({ type: String, format: 'uuid', example: ids.floorId })
  @IsOptional()
  floorId?: unknown;
  @ApiPropertyOptional() @IsOptional() FloorId?: unknown;

  @ApiPropertyOptional({ type: String, example: 'Tầng B1' })
  @IsOptional()
  floorName?: unknown;
  @ApiPropertyOptional() @IsOptional() FloorName?: unknown;

  @ApiPropertyOptional({ type: String, format: 'uuid', example: ids.vehicleTypeId })
  @IsOptional()
  dedicatedVehicleTypeId?: unknown;
  @ApiPropertyOptional() @IsOptional() DedicatedVehicleTypeId?: unknown;

  @ApiPropertyOptional({ type: Number, example: 120 })
  @IsOptional()
  totalCapacity?: unknown;
  @ApiPropertyOptional() @IsOptional() TotalCapacity?: unknown;

  @ApiPropertyOptional({ type: Boolean, example: false })
  @IsOptional()
  isResident?: unknown;
  @ApiPropertyOptional() @IsOptional() IsResident?: unknown;

  @ApiPropertyOptional({ type: String, format: 'uuid', example: ids.gateEntryId })
  @IsOptional()
  gateId?: unknown;
  @ApiPropertyOptional() @IsOptional() GateId?: unknown;

  @ApiPropertyOptional({ type: String, example: 'Cổng vào A' })
  @IsOptional()
  gateName?: unknown;
  @ApiPropertyOptional() @IsOptional() GateName?: unknown;

  @ApiPropertyOptional({ type: String, example: 'Entry' })
  @IsOptional()
  gateType?: unknown;
  @ApiPropertyOptional() @IsOptional() GateType?: unknown;

  @ApiPropertyOptional({ type: String, format: 'uuid', example: ids.slotId })
  @IsOptional()
  parkingSlotId?: unknown;
  @ApiPropertyOptional() @IsOptional() ParkingSlotId?: unknown;

  @ApiPropertyOptional({ type: String, format: 'uuid', example: ids.slotId })
  @IsOptional()
  slotId?: unknown;
  @ApiPropertyOptional() @IsOptional() SlotId?: unknown;

  @ApiPropertyOptional({ type: String, example: 'B1-A12' })
  @IsOptional()
  slotCode?: unknown;
  @ApiPropertyOptional() @IsOptional() SlotCode?: unknown;

  @ApiPropertyOptional({ type: String, example: 'Available' })
  @IsOptional()
  status?: unknown;
  @ApiPropertyOptional() @IsOptional() Status?: unknown;

  @ApiPropertyOptional({ type: String, format: 'uuid', example: ids.policyId })
  @IsOptional()
  pricingPolicyId?: unknown;
  @ApiPropertyOptional() @IsOptional() PricingPolicyId?: unknown;

  @ApiPropertyOptional({ type: String, format: 'uuid', example: ids.policyId })
  @IsOptional()
  policyId?: unknown;
  @ApiPropertyOptional() @IsOptional() PolicyId?: unknown;

  @ApiPropertyOptional({ type: Number, example: 5000 })
  @IsOptional()
  basePrice?: unknown;
  @ApiPropertyOptional() @IsOptional() BasePrice?: unknown;

  @ApiPropertyOptional({ type: Number, example: 1 })
  @IsOptional()
  baseHours?: unknown;
  @ApiPropertyOptional() @IsOptional() BaseHours?: unknown;

  @ApiPropertyOptional({ type: Number, example: 3000 })
  @IsOptional()
  extraHourPrice?: unknown;
  @ApiPropertyOptional() @IsOptional() ExtraHourPrice?: unknown;

  @ApiPropertyOptional({ type: Number, example: 2000 })
  @IsOptional()
  nightSurcharge?: unknown;
  @ApiPropertyOptional() @IsOptional() NightSurcharge?: unknown;

  @ApiPropertyOptional({ type: String, format: 'date-time', example: '2026-09-01T00:00:00.000Z' })
  @IsOptional()
  effectiveDate?: unknown;
  @ApiPropertyOptional() @IsOptional() EffectiveDate?: unknown;

  @ApiPropertyOptional({ type: String, format: 'uuid', example: ids.packageId })
  @IsOptional()
  packageId?: unknown;
  @ApiPropertyOptional() @IsOptional() PackageId?: unknown;

  @ApiPropertyOptional({ type: String, example: 'Gói tháng xe máy' })
  @IsOptional()
  packageName?: unknown;
  @ApiPropertyOptional() @IsOptional() PackageName?: unknown;

  @ApiPropertyOptional({ type: Number, example: 1 })
  @IsOptional()
  durationMonths?: unknown;
  @ApiPropertyOptional() @IsOptional() DurationMonths?: unknown;

  @ApiPropertyOptional({ type: Number, example: 300000 })
  @IsOptional()
  price?: unknown;
  @ApiPropertyOptional() @IsOptional() Price?: unknown;

  @ApiPropertyOptional({ type: Boolean, example: true })
  @IsOptional()
  requireFixedSlot?: unknown;
  @ApiPropertyOptional() @IsOptional() RequireFixedSlot?: unknown;

  @ApiPropertyOptional({ type: String, format: 'uuid', example: ids.userId })
  @IsOptional()
  userId?: unknown;
  @ApiPropertyOptional() @IsOptional() UserId?: unknown;

  @ApiPropertyOptional({ type: String, example: '59A12345' })
  @IsOptional()
  licensePlate?: unknown;
  @ApiPropertyOptional() @IsOptional() LicensePlate?: unknown;

  @ApiPropertyOptional({ type: String, format: 'uuid', example: ids.slotId })
  @IsOptional()
  fixedSlotId?: unknown;
  @ApiPropertyOptional() @IsOptional() FixedSlotId?: unknown;

  @ApiPropertyOptional({ type: String, format: 'date-time', example: '2026-09-01T00:00:00.000Z' })
  @IsOptional()
  startDate?: unknown;
  @ApiPropertyOptional() @IsOptional() StartDate?: unknown;

  @ApiPropertyOptional({ type: String, format: 'date-time', example: '2026-12-01T00:00:00.000Z' })
  @IsOptional()
  endDate?: unknown;
  @ApiPropertyOptional() @IsOptional() EndDate?: unknown;

  @ApiPropertyOptional({ type: Number, example: 1 })
  @IsOptional()
  months?: unknown;
  @ApiPropertyOptional() @IsOptional() Months?: unknown;

  @ApiPropertyOptional({ type: Number, example: 11000 })
  @IsOptional()
  amount?: unknown;
  @ApiPropertyOptional() @IsOptional() Amount?: unknown;

  @ApiPropertyOptional({ type: String, format: 'uuid', example: ids.subscriptionId })
  @IsOptional()
  subscriptionId?: unknown;
  @ApiPropertyOptional() @IsOptional() SubscriptionId?: unknown;

  @ApiPropertyOptional({ type: String, format: 'uuid', example: ids.renewalId })
  @IsOptional()
  renewalId?: unknown;
  @ApiPropertyOptional() @IsOptional() RenewalId?: unknown;

  @ApiPropertyOptional({ type: String, format: 'date-time', example: '2026-09-15T08:30:00.000Z' })
  @IsOptional()
  renewalDate?: unknown;
  @ApiPropertyOptional() @IsOptional() RenewalDate?: unknown;

  @ApiPropertyOptional({ type: String, example: '59B67890' })
  @IsOptional()
  newLicensePlate?: unknown;
  @ApiPropertyOptional() @IsOptional() NewLicensePlate?: unknown;

  @ApiPropertyOptional({ type: String, example: 'Đổi xe mới' })
  @IsOptional()
  reason?: unknown;
  @ApiPropertyOptional() @IsOptional() Reason?: unknown;

  @ApiPropertyOptional({ type: String, format: 'date-time', example: '2026-09-18T09:00:00.000Z' })
  @IsOptional()
  expectedEntryTime?: unknown;
  @ApiPropertyOptional() @IsOptional() ExpectedEntryTime?: unknown;

  @ApiPropertyOptional({ type: String, format: 'date-time', example: '2026-09-18T10:30:00.000Z' })
  @IsOptional()
  newExpectedTime?: unknown;
  @ApiPropertyOptional() @IsOptional() NewExpectedTime?: unknown;

  @ApiPropertyOptional({ type: String, format: 'uuid', example: ids.paymentId })
  @IsOptional()
  paymentId?: unknown;
  @ApiPropertyOptional() @IsOptional() PaymentId?: unknown;

  @ApiPropertyOptional({ type: String, format: 'uuid', example: ids.sessionId })
  @IsOptional()
  sessionId?: unknown;
  @ApiPropertyOptional() @IsOptional() SessionId?: unknown;

  @ApiPropertyOptional({ type: String, format: 'uuid', example: ids.reservationId })
  @IsOptional()
  reservationId?: unknown;
  @ApiPropertyOptional() @IsOptional() ReservationId?: unknown;

  @ApiPropertyOptional({ type: String, example: 'Cash' })
  @IsOptional()
  paymentMethod?: unknown;
  @ApiPropertyOptional() @IsOptional() PaymentMethod?: unknown;

  @ApiPropertyOptional({ type: String, example: 'CheckoutFee' })
  @IsOptional()
  paymentType?: unknown;
  @ApiPropertyOptional() @IsOptional() PaymentType?: unknown;

  @ApiPropertyOptional({ type: String, format: 'date-time', example: '2026-09-17T11:45:00.000Z' })
  @IsOptional()
  paymentTime?: unknown;
  @ApiPropertyOptional() @IsOptional() PaymentTime?: unknown;

  @ApiPropertyOptional({ type: String, example: 'Success' })
  @IsOptional()
  paymentStatus?: unknown;
  @ApiPropertyOptional() @IsOptional() PaymentStatus?: unknown;

  @ApiPropertyOptional({ type: String, example: 'CASH-20260917-01' })
  @IsOptional()
  transactionReference?: unknown;
  @ApiPropertyOptional() @IsOptional() TransactionReference?: unknown;

  @ApiPropertyOptional({ type: String, example: 'WalkIn' })
  @IsOptional()
  customerType?: unknown;
  @ApiPropertyOptional() @IsOptional() CustomerType?: unknown;

  @ApiPropertyOptional({ type: String, format: 'uuid', example: ids.sessionId })
  @IsOptional()
  qrPayload?: unknown;
  @ApiPropertyOptional() @IsOptional() QrPayload?: unknown;

  @ApiPropertyOptional({ type: String, example: 'https://api.example.com/uploads/entry-59A12345.jpg' })
  @IsOptional()
  entryImageUrl?: unknown;
  @ApiPropertyOptional() @IsOptional() EntryImageUrl?: unknown;

  @ApiPropertyOptional({ type: String, example: 'https://api.example.com/uploads/driver-in.jpg' })
  @IsOptional()
  driverEntryImageUrl?: unknown;
  @ApiPropertyOptional() @IsOptional() DriverEntryImageUrl?: unknown;

  @ApiPropertyOptional({ type: String, example: 'https://api.example.com/uploads/exit-59A12345.jpg' })
  @IsOptional()
  exitImageUrl?: unknown;
  @ApiPropertyOptional() @IsOptional() ExitImageUrl?: unknown;

  @ApiPropertyOptional({ type: String, example: 'https://api.example.com/uploads/driver-out.jpg' })
  @IsOptional()
  driverExitImageUrl?: unknown;
  @ApiPropertyOptional() @IsOptional() DriverExitImageUrl?: unknown;

  @ApiPropertyOptional({ type: String, example: '59A12345' })
  @IsOptional()
  licensePlateOut?: unknown;
  @ApiPropertyOptional() @IsOptional() LicensePlateOut?: unknown;

  @ApiPropertyOptional({ type: String, example: '59A12345' })
  @IsOptional()
  licensePlateIn?: unknown;
  @ApiPropertyOptional() @IsOptional() LicensePlateIn?: unknown;

  @ApiPropertyOptional({ type: String, format: 'uuid', example: ids.userId })
  @IsOptional()
  driverUserId?: unknown;
  @ApiPropertyOptional() @IsOptional() DriverUserId?: unknown;

  @ApiPropertyOptional({ type: String, format: 'date-time', example: '2026-09-17T08:15:00.000Z' })
  @IsOptional()
  entryTime?: unknown;
  @ApiPropertyOptional() @IsOptional() EntryTime?: unknown;

  @ApiPropertyOptional({ type: String, format: 'date-time', example: '2026-09-17T11:45:00.000Z' })
  @IsOptional()
  exitTime?: unknown;
  @ApiPropertyOptional() @IsOptional() ExitTime?: unknown;

  @ApiPropertyOptional({ type: String, format: 'uuid', example: ids.gateEntryId })
  @IsOptional()
  entryGateId?: unknown;
  @ApiPropertyOptional() @IsOptional() EntryGateId?: unknown;

  @ApiPropertyOptional({ type: String, format: 'uuid', example: ids.gateExitId })
  @IsOptional()
  exitGateId?: unknown;
  @ApiPropertyOptional() @IsOptional() ExitGateId?: unknown;

  @ApiPropertyOptional({ type: String, format: 'uuid', example: ids.slotId })
  @IsOptional()
  assignedSlotId?: unknown;
  @ApiPropertyOptional() @IsOptional() AssignedSlotId?: unknown;

  @ApiPropertyOptional({ type: String, format: 'uuid', example: ids.slotId })
  @IsOptional()
  actualSlotId?: unknown;
  @ApiPropertyOptional() @IsOptional() ActualSlotId?: unknown;

  @ApiPropertyOptional({ type: String, format: 'uuid', example: ids.incidentId })
  @IsOptional()
  incidentId?: unknown;
  @ApiPropertyOptional() @IsOptional() IncidentId?: unknown;

  @ApiPropertyOptional({ type: String, format: 'uuid', example: ids.userId })
  @IsOptional()
  reportedByUserId?: unknown;
  @ApiPropertyOptional() @IsOptional() ReportedByUserId?: unknown;

  @ApiPropertyOptional({ type: String, example: 'SlotOccupied' })
  @IsOptional()
  issueType?: unknown;
  @ApiPropertyOptional() @IsOptional() IssueType?: unknown;

  @ApiPropertyOptional({ type: String, example: 'https://api.example.com/uploads/incidents/proof.jpg' })
  @IsOptional()
  proofImageUrl?: unknown;
  @ApiPropertyOptional() @IsOptional() ProofImageUrl?: unknown;

  @ApiPropertyOptional({ type: String, format: 'uuid', example: ids.staffId })
  @IsOptional()
  handledByStaffId?: unknown;
  @ApiPropertyOptional() @IsOptional() HandledByStaffId?: unknown;

  @ApiPropertyOptional({ type: String, format: 'date-time', example: '2026-09-17T14:00:00.000Z' })
  @IsOptional()
  resolvedAt?: unknown;
  @ApiPropertyOptional() @IsOptional() ResolvedAt?: unknown;

  @ApiPropertyOptional({ type: String, example: 'Đã xác minh và giải phóng ô đỗ' })
  @IsOptional()
  resolutionNotes?: unknown;
  @ApiPropertyOptional() @IsOptional() ResolutionNotes?: unknown;

  @ApiPropertyOptional({ type: String, format: 'date-time', example: '2026-09-01T00:00:00.000Z' })
  @IsOptional()
  from?: unknown;
  @ApiPropertyOptional() @IsOptional() From?: unknown;

  @ApiPropertyOptional({ type: String, format: 'date-time', example: '2026-09-17T23:59:59.000Z' })
  @IsOptional()
  to?: unknown;
  @ApiPropertyOptional() @IsOptional() To?: unknown;

  @ApiPropertyOptional({ type: String, example: 'day' })
  @IsOptional()
  groupBy?: unknown;
  @ApiPropertyOptional() @IsOptional() GroupBy?: unknown;

  @ApiPropertyOptional({ type: String, example: '2026-09' })
  @IsOptional()
  period?: unknown;
  @ApiPropertyOptional() @IsOptional() Period?: unknown;

  @ApiPropertyOptional({ type: String, example: 'full' })
  @IsOptional()
  reportType?: unknown;
  @ApiPropertyOptional() @IsOptional() ReportType?: unknown;

  @ApiPropertyOptional({ type: String, example: 'pdf' })
  @IsOptional()
  format?: unknown;
  @ApiPropertyOptional() @IsOptional() Format?: unknown;
}
