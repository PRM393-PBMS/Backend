/** Dữ liệu giả thống nhất cho Swagger — không phải secret môi trường. */

export const PBMS_REGISTER_EXAMPLE = {
  userName: 'fonfon',
  fullName: 'Huỳnh Dũng Phong',
  email: 'fonHocPRM393@gmail.com',
  phoneNumber: '0123456789',
  password: 'passcuafon@123',
  confirmPassword: 'passcuafon@123',
} as const;

export const ids = {
  userId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
  staffId: 'a3bb189e-8bf9-3888-91fa-8d7ee3d3ba87',
  roleUserId: 1,
  roleStaffId: 2,
  vehicleTypeId: '550e8400-e29b-41d4-a716-446655440000',
  floorId: '6ec0bd7f-11c0-43da-975e-2a8ad9ebae0b',
  gateEntryId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  gateExitId: '11111111-2222-4333-8444-555555555555',
  slotId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  policyId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  packageId: '1b4e28ba-2fa1-11d2-883f-0016d3cca427',
  subscriptionId: '21ec2020-3aea-4069-a3dd-80aa0c99e3e0',
  renewalId: '123e4567-e89b-12d3-a456-426614174000',
  changeRequestId: '0f14d0ab-9605-4a62-a9e4-5ed266883890',
  sessionId: 'e2a1b8c4-9d3f-4a12-8c7e-1f2a3b4c5d6e',
  reservationId: '8f14e45f-ceea-467c-9d74-88e12ab117b2',
  paymentId: '2c5ea4c0-4067-11e9-8bad-9b1deb4d3b7d',
  incidentId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
  walletId: '9c5ea4c0-4067-41e9-8bad-9b1deb4d3b7d',
};

export const dummyAccessToken =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI5YjFkZWI0ZC0zYjdkLTRiYWQtOWJkZC0yYjBkN2IzZGNiNmQiLCJlbWFpbCI6ImZvbkhvY1BSTTM5M0BnbWFpbC5jb20ifQ.example-access-token';

export const dummyRefreshToken =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI5YjFkZWI0ZC0zYjdkLTRiYWQtOWJkZC0yYjBkN2IzZGNiNmQiLCJ0eXBlIjoicmVmcmVzaCJ9.example-refresh-token';

const iso = {
  created: '2026-09-10T07:00:00.000Z',
  updated: '2026-09-15T08:30:00.000Z',
  entry: '2026-09-17T08:15:00.000Z',
  exit: '2026-09-17T11:45:00.000Z',
  expected: '2026-09-18T09:00:00.000Z',
  start: '2026-09-01T00:00:00.000Z',
  end: '2026-12-01T00:00:00.000Z',
  effective: '2026-09-01T00:00:00.000Z',
  resolved: '2026-09-17T14:00:00.000Z',
};

export const userExample = {
  userId: ids.userId,
  userName: PBMS_REGISTER_EXAMPLE.userName,
  email: PBMS_REGISTER_EXAMPLE.email,
  fullName: PBMS_REGISTER_EXAMPLE.fullName,
  phoneNumber: PBMS_REGISTER_EXAMPLE.phoneNumber,
  status: 'Active',
  roleId: ids.roleUserId,
  roleName: 'customer',
  avatarUrl: 'https://api.example.com/uploads/avatars/9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d.jpg',
  walletId: ids.walletId,
  createdAt: iso.created,
  updatedAt: iso.updated,
};

export const loginResultExample = {
  user: {
    userId: ids.userId,
    userName: PBMS_REGISTER_EXAMPLE.userName,
    email: PBMS_REGISTER_EXAMPLE.email,
    fullName: PBMS_REGISTER_EXAMPLE.fullName,
    phoneNumber: PBMS_REGISTER_EXAMPLE.phoneNumber,
    roleName: 'customer',
    avatarUrl: 'https://api.example.com/uploads/avatars/9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d.jpg',
    walletId: ids.walletId,
  },
  accessToken: dummyAccessToken,
  refreshToken: dummyRefreshToken,
};

export const roleExample = {
  roleId: ids.roleStaffId,
  roleName: 'staff',
  description: 'Nhân viên vận hành bãi xe',
};

export const vehicleTypeExample = {
  vehicleTypeId: ids.vehicleTypeId,
  typeName: 'Xe máy',
  dimensions: '2.0m x 0.8m',
};

export const floorExample = {
  floorId: ids.floorId,
  floorName: 'Tầng B1',
  dedicatedVehicleTypeId: ids.vehicleTypeId,
  dedicatedVehicleTypeName: 'Xe máy',
  totalCapacity: 120,
  isResident: false,
};

export const gateExample = {
  gateId: ids.gateEntryId,
  gateName: 'Cổng vào A',
  gateType: 'Entry',
  floorId: ids.floorId,
  floorName: 'Tầng B1',
};

export const slotExample = {
  slotId: ids.slotId,
  floorId: ids.floorId,
  floorName: 'Tầng B1',
  slotCode: 'B1-A12',
  vehicleTypeId: ids.vehicleTypeId,
  vehicleTypeName: 'Xe máy',
  status: 'Available',
  isResident: false,
};

export const pricingPolicyExample = {
  policyId: ids.policyId,
  vehicleTypeId: ids.vehicleTypeId,
  vehicleTypeName: 'Xe máy',
  basePrice: 5000,
  baseHours: 1,
  extraHourPrice: 3000,
  nightSurcharge: 2000,
  effectiveDate: iso.effective,
  status: 'Active',
};

export const packageExample = {
  packageId: ids.packageId,
  packageName: 'Gói tháng xe máy',
  vehicleTypeId: ids.vehicleTypeId,
  vehicleTypeName: 'Xe máy',
  durationMonths: 1,
  durationDays: 30,
  price: 300000,
  requireFixedSlot: true,
  description: 'Thuê bao tháng, ưu tiên ô cố định',
  status: 'Active',
};

export const subscriptionExample = {
  subscriptionId: ids.subscriptionId,
  userId: ids.userId,
  fullName: PBMS_REGISTER_EXAMPLE.fullName,
  licensePlate: '59A12345',
  vehicleType: 'Xe máy',
  packageName: 'Gói tháng xe máy',
  startDate: iso.start,
  endDate: iso.end,
  price: 300000,
  status: 'Active',
  fixedSlot: 'B1-A12',
};

export const subscriptionPaymentExample = {
  subscriptionId: ids.subscriptionId,
  paymentId: ids.paymentId,
  paymentMethod: 'PayOS',
  orderCode: 'PBMS-20260917-1001',
  amount: 300000,
  paymentLinkId: 'plink_demo_not_a_secret',
  paymentUrl: 'https://pay.payos.vn/web/plink_demo_not_a_secret',
  status: 'PendingPayment',
};

export const subscriptionWalletPaymentExample = {
  subscriptionId: ids.subscriptionId,
  paymentId: ids.paymentId,
  paymentMethod: 'Wallet',
  amount: 300000,
  walletId: ids.walletId,
  walletBalance: 50000,
  status: 'Active',
};

export const walletTransactionExample = {
  walletTransactionId: '3c5ea4c0-4067-11e9-8bad-9b1deb4d3b7d',
  direction: 'Credit',
  type: 'TopUp',
  amount: 150000,
  absoluteAmount: 150000,
  balanceAfter: 150000,
  createdAt: iso.updated,
  paymentId: ids.paymentId,
  subscriptionId: null,
  paymentMethod: 'PayOS',
  paymentType: 'WalletTopUp',
  orderCode: '1727000000001',
  packageName: null,
  licensePlate: null,
  description: 'Nạp ví qua PayOS',
};

export const walletSpendExample = {
  walletTransactionId: '4c5ea4c0-4067-11e9-8bad-9b1deb4d3b7d',
  direction: 'Debit',
  type: 'SubscriptionFee',
  amount: -300000,
  absoluteAmount: 300000,
  balanceAfter: 50000,
  createdAt: iso.updated,
  paymentId: ids.paymentId,
  subscriptionId: ids.subscriptionId,
  paymentMethod: 'Wallet',
  paymentType: 'SubscriptionFee',
  orderCode: 'WALLET-21ec20203aea',
  packageName: 'Gói tháng xe máy',
  licensePlate: '59A12345',
  description: 'Mua gói tháng Gói tháng xe máy — 59A12345',
};

export const walletExample = {
  walletId: ids.walletId,
  userId: ids.userId,
  walletBalance: 150000,
  transactions: [walletTransactionExample, walletSpendExample],
};

export const walletTopUpExample = {
  walletId: ids.walletId,
  paymentId: ids.paymentId,
  paymentMethod: 'PayOS',
  paymentType: 'WalletTopUp',
  amount: 100000,
  walletBalance: 150000,
  paymentLinkId: 'plink_demo_not_a_secret',
  paymentUrl: 'https://pay.payos.vn/web/plink_demo_not_a_secret',
  orderCode: '1727000000001',
};

export const renewalExample = {
  renewalId: ids.renewalId,
  subscriptionId: ids.subscriptionId,
  oldEndDate: iso.end,
  newEndDate: '2027-01-01T00:00:00.000Z',
  amount: 300000,
  renewalDate: iso.updated,
};

export const vehicleChangeExample = {
  requestId: ids.changeRequestId,
  subscriptionId: ids.subscriptionId,
  oldLicensePlate: '59A12345',
  newLicensePlate: '59B67890',
  reason: 'Đổi xe mới',
  rejectionReason: null,
  status: 'Pending',
  createdAt: iso.created,
  processedAt: null,
  userFullName: PBMS_REGISTER_EXAMPLE.fullName,
  packageName: 'Gói tháng xe máy',
  handledByStaffId: null,
  handledByFullName: null,
};

const ticketExample = {
  qrPayload: ids.sessionId,
  qrCodeDataUrl:
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
};

export const sessionExample = {
  sessionId: ids.sessionId,
  reservationId: ids.reservationId,
  driverUserId: ids.userId,
  driverFullName: PBMS_REGISTER_EXAMPLE.fullName,
  licensePlateIn: '59A12345',
  licensePlateOut: null,
  entryImageUrl: 'https://api.example.com/uploads/entry-59A12345.jpg',
  driverEntryImageUrl: 'https://api.example.com/uploads/driver-in.jpg',
  exitImageUrl: null,
  driverExitImageUrl: null,
  vehicleTypeId: ids.vehicleTypeId,
  vehicleTypeName: 'Xe máy',
  entryTime: iso.entry,
  exitTime: null,
  entryGateId: ids.gateEntryId,
  entryGateName: 'Cổng vào A',
  exitGateId: null,
  exitGateName: null,
  assignedSlotId: ids.slotId,
  assignedSlotCode: 'B1-A12',
  actualSlotId: ids.slotId,
  actualSlotCode: 'B1-A12',
  status: 'Active',
  paymentAmount: null,
  paymentStatus: null,
  paymentMethod: null,
  paymentTime: null,
  ticket: ticketExample,
};

export const feeExample = {
  amount: 11000,
  basePrice: 5000,
  extraHours: 2,
  extraHourPrice: 3000,
  nightSurcharge: 0,
};

export const paymentExample = {
  paymentId: ids.paymentId,
  userId: ids.userId,
  sessionId: ids.sessionId,
  reservationId: ids.reservationId,
  subscriptionId: null,
  amount: 11000,
  paymentMethod: 'Cash',
  paymentType: 'CheckoutFee',
  paymentTime: iso.exit,
  paymentStatus: 'Success',
  transactionReference: 'CASH-20260917-01',
};

export const reservationExample = {
  reservationId: ids.reservationId,
  userId: ids.userId,
  userFullName: PBMS_REGISTER_EXAMPLE.fullName,
  vehicleTypeId: ids.vehicleTypeId,
  vehicleTypeName: 'Xe máy',
  expectedEntryTime: iso.expected,
  status: 'Confirmed',
  createdAt: iso.created,
  ticket: ticketExample,
};

export const incidentExample = {
  incidentId: ids.incidentId,
  sessionId: ids.sessionId,
  reportedByUserId: ids.userId,
  reportedByUserFullName: PBMS_REGISTER_EXAMPLE.fullName,
  issueType: 'SlotOccupied',
  description: 'Ô B1-A12 đang bị chiếm khi đã gán cho khách tháng',
  proofImageUrl: 'https://api.example.com/uploads/incidents/proof.jpg',
  status: 'Open',
  handledByStaffId: null,
  handledByStaffFullName: null,
  resolvedAt: null,
  resolutionNotes: null,
};

export const reportTypesExample = [
  {
    key: 'full',
    name: 'Báo cáo thống kê đầy đủ',
    description: 'Gộp tổng quan, doanh thu và vận hành bãi xe trong cùng một file PDF.',
    supportedFormats: ['pdf'],
  },
];

export const reportSummaryExample = {
  range: {
    from: iso.start,
    to: iso.end,
    groupBy: 'day',
    vehicleTypeId: ids.vehicleTypeId,
  },
  metrics: [
    { key: 'totalRevenue', name: 'Tổng doanh thu', value: 12500000, unit: 'VND' },
    { key: 'successfulPayments', name: 'Số thanh toán thành công', value: 48, unit: 'lần' },
    { key: 'entries', name: 'Lượt xe vào', value: 210, unit: 'lượt' },
    { key: 'exits', name: 'Lượt xe ra', value: 198, unit: 'lượt' },
    { key: 'slotUtilizationRate', name: 'Tỷ lệ sử dụng chỗ đỗ', value: 72.5, unit: '%' },
  ],
  revenueSeries: [{ period: '2026-09-17', amount: 450000 }],
  revenueByPaymentType: [{ key: 'CheckoutFee', amount: 320000 }],
  revenueByPaymentMethod: [{ key: 'Cash', amount: 180000 }],
  slots: { total: 120, occupied: 87, available: 33, utilizationRate: 72.5 },
  slotOccupancyByFloor: [{ floorName: 'Tầng B1', occupied: 80, total: 120 }],
};
