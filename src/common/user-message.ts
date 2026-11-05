/** Public copy only. Keep errorCode/requestId/details for programmatic recovery. */
export const INVALID_CREDENTIALS_MESSAGE =
  'Tài khoản hoặc mật khẩu không đúng. Vui lòng kiểm tra lại.';

const fields: Record<string, string> = {
  id: 'Mục đã chọn',
  userId: 'Tài khoản',
  vehicleId: 'Xe',
  vehicleTypeId: 'Loại xe',
  parkingId: 'Bãi đỗ',
  floorId: 'Tầng đỗ',
  slotId: 'Ô đỗ',
  parkingSlotId: 'Ô đỗ',
  gateId: 'Cổng',
  sessionId: 'Lượt gửi xe',
  reservationId: 'Đơn đặt chỗ',
  paymentId: 'Thanh toán',
  subscriptionId: 'Vé tháng',
  monthlySubscriptionId: 'Vé tháng',
  packageId: 'Gói vé',
  subscriptionPackageId: 'Gói vé',
  renewalId: 'Gia hạn',
  requestId: 'Yêu cầu',
  walletId: 'Ví',
  incidentId: 'Sự cố',
  roleId: 'Vai trò',
  userName: 'Tên đăng nhập',
  fullName: 'Họ và tên',
  phoneNumber: 'Số điện thoại',
  licensePlate: 'Biển số',
  licensePlateIn: 'Biển số vào',
  licensePlateOut: 'Biển số ra',
  newLicensePlate: 'Biển số mới',
  typeName: 'Tên loại xe',
  dimensions: 'Kích thước',
  floorName: 'Tên tầng',
  gateName: 'Tên cổng',
  slotCode: 'Tên ô đỗ',
  packageName: 'Tên gói vé',
  description: 'Mô tả',
  reason: 'Lý do',
  signerName: 'Người ký',
  name: 'Tên',
  location: 'Địa chỉ',
  nickname: 'Tên xe',
  modelName: 'Dòng xe',
  amount: 'Số tiền',
  price: 'Giá',
  basePrice: 'Giá cơ bản',
  extraHourPrice: 'Phí mỗi giờ thêm',
  nightSurcharge: 'Phụ phí ban đêm',
  baseHours: 'Số giờ cơ bản',
  durationDays: 'Số ngày',
  durationMonths: 'Số tháng',
  totalCapacity: 'Sức chứa',
  months: 'Số tháng',
  latitude: 'Vĩ độ',
  longitude: 'Kinh độ',
  page: 'Trang',
  limit: 'Số mục mỗi trang',
  isResident: 'Lựa chọn cư dân',
  requireFixedSlot: 'Lựa chọn ô cố định',
  allParkings: 'Phạm vi bãi đỗ',
  autoRenew: 'Tự động gia hạn',
  agreed: 'Xác nhận đồng ý',
  isActive: 'Trạng thái hoạt động',
  expectedTime: 'Giờ đến',
  newExpectedTime: 'Giờ đến mới',
  startDate: 'Ngày bắt đầu',
  endDate: 'Ngày kết thúc',
  fromDate: 'Ngày bắt đầu',
  toDate: 'Ngày kết thúc',
  entryTime: 'Giờ vào',
  exitTime: 'Giờ ra',
  status: 'Trạng thái',
};
const terms: Record<string, string> = {
  entrypass: 'mã vào bãi',
  reservation: 'đơn đặt chỗ',
  subscription: 'vé tháng',
  payment: 'thanh toán',
  prepay: 'trả trước',
  checkout: 'ra bãi',
  slot: 'ô đỗ',
  floor: 'tầng',
  gate: 'cổng',
  capacity: 'sức chứa',
  quota: 'số chỗ có thể đặt',
  contract: 'hợp đồng',
  pendingpayment: 'chờ thanh toán',
  pending: 'đang chờ',
  active: 'đang hoạt động',
  used: 'đã sử dụng',
  cancelled: 'đã hủy',
  expired: 'hết hạn',
  noshow: 'quá giờ đến',
  completed: 'đã hoàn tất',
  confirmed: 'đã xác nhận',
};
const fieldNames = new Map(
  Object.entries(fields).map(([key, value]) => [key.toLowerCase(), value]),
);
export const inputFieldName = (key: string): string =>
  fieldNames.get(key.toLowerCase()) ?? 'Thông tin này';

const byCode: Record<string, string> = {
  DATABASE_UNAVAILABLE:
    'Hệ thống tạm thời không khả dụng. Vui lòng thử lại sau.',
  DEPENDENCY_UNAVAILABLE:
    'Hệ thống tạm thời không khả dụng. Vui lòng thử lại sau.',
  OTP_STORE_UNAVAILABLE: 'Chưa thể xác thực lúc này. Vui lòng thử lại sau.',
  MAIL_NOT_CONFIGURED:
    'Chưa gửi được email. Vui lòng thử lại sau hoặc liên hệ hỗ trợ.',
  MAIL_SEND_FAILED: 'Chưa gửi được email. Vui lòng thử lại sau.',
  MAIL_TIMEOUT:
    'Chưa xác nhận email đã được gửi. Vui lòng kiểm tra hộp thư và thư rác trước khi yêu cầu gửi lại.',
  INVALID_JSON:
    'Không đọc được thông tin đã gửi. Vui lòng kiểm tra và thử lại.',
  INVALID_BODY: 'Thông tin đã gửi chưa hợp lệ. Vui lòng kiểm tra và thử lại.',
  INVALID_IDEMPOTENCY_KEY:
    'Không xác nhận được yêu cầu này. Vui lòng tải lại trạng thái trước khi thử lại.',
  IDEMPOTENCY_MISMATCH:
    'Yêu cầu này đã được gửi với thông tin khác. Vui lòng kiểm tra lịch sử trước khi tạo yêu cầu mới.',
  OPERATION_PENDING:
    'Yêu cầu trước đang được xử lý. Vui lòng kiểm tra trạng thái trước khi thử lại.',
  PAYMENT_STATUS_UNKNOWN:
    'Chưa xác định được kết quả thanh toán. Vui lòng kiểm tra lịch sử trước khi thanh toán lại.',
  RESOURCE_CONFLICT:
    'Thông tin này đã tồn tại hoặc đang được xử lý. Vui lòng kiểm tra và tải lại.',
  DOMAIN_CONSTRAINT:
    'Chưa thể thay đổi vì thông tin này đang được sử dụng. Vui lòng tải lại hoặc liên hệ hỗ trợ.',
  RELATION_CONFLICT:
    'Thông tin liên quan đã thay đổi hoặc đang được sử dụng. Vui lòng tải lại và chọn lại.',
};

export function userErrorMessage(
  message: unknown,
  status: number,
  code?: string,
): string {
  const raw = typeof message === 'string' ? message.trim() : '';
  if (/invalid credentials?|tài khoản hoặc mật khẩu/i.test(raw))
    return INVALID_CREDENTIALS_MESSAGE;
  if (code && byCode[code]) return byCode[code];
  const fallback: Record<number, string> = {
    400: 'Thông tin chưa hợp lệ. Vui lòng kiểm tra và thử lại.',
    401: 'Phiên đăng nhập đã hết hạn hoặc không hợp lệ. Vui lòng đăng nhập lại.',
    402: 'Số dư ví không đủ. Vui lòng nạp thêm tiền hoặc chọn cách thanh toán khác.',
    403: 'Bạn không thể thực hiện thao tác này. Vui lòng kiểm tra tài khoản hoặc liên hệ hỗ trợ.',
    404: 'Không tìm thấy thông tin này. Vui lòng tải lại hoặc chọn mục khác.',
    409: 'Thông tin đã thay đổi hoặc yêu cầu đang được xử lý. Vui lòng tải lại trạng thái.',
    413: 'Tệp quá lớn. Vui lòng chọn ảnh không quá 5 MB.',
    415: 'Định dạng tệp chưa được hỗ trợ. Vui lòng chọn ảnh JPG hoặc PNG.',
    422: 'Chưa đọc được thông tin từ ảnh. Vui lòng chụp lại rõ hơn hoặc nhập biển số.',
    429: 'Bạn thao tác quá nhanh. Vui lòng chờ một lát rồi thử lại.',
    502: 'Chưa nhận được phản hồi phù hợp. Vui lòng kiểm tra trạng thái và thử lại sau.',
    503: 'Hệ thống tạm thời không khả dụng. Vui lòng thử lại sau.',
    504: 'Chưa xác định được kết quả yêu cầu. Vui lòng kiểm tra trạng thái trước khi thử lại.',
  };
  const generic =
    fallback[status] ?? 'Đã có sự cố xảy ra. Vui lòng thử lại sau.';
  if (status >= 500) return generic;
  if (/\b(?:token|jwt)\b/i.test(raw)) return fallback[401];
  if (
    !raw ||
    raw.length > 600 ||
    /[\r\n<>{}]/.test(raw) ||
    /prisma|exception|stacktrace|\b(?:select|insert|update|delete)\s+\w+\s+(?:from|into|set)|ECONN|ETIMEDOUT|node_modules|https?:\/\//i.test(
      raw,
    )
  )
    return generic;
  const text = raw
    .replace(
      /\b[a-z][a-zA-Z0-9]*\b/gi,
      (word) =>
        fieldNames.get(word.toLowerCase()) ?? terms[word.toLowerCase()] ?? word,
    )
    .replace(/\bUUID\b/gi, 'mã nhận diện')
    .replace(/\bISO\b/gi, 'đúng định dạng')
    .replace(/true hoặc false/gi, 'một lựa chọn hợp lệ');
  // Untranslated provider/framework errors are never primary UI copy.
  if (
    !/[À-ỹĐđ]/u.test(text) ||
    /\b[A-Za-z]+(?:Id|Time|Date|At)\b|\b(?:payload|body|JSON|constraint|rollback)\b/.test(
      text,
    )
  )
    return generic;
  return text;
}
