/**
 * Quy tắc đặt chỗ trước (ô tô). Một chỗ dùng chung cho backend: tạo đơn, đổi giờ, huỷ,
 * check-in ở cổng và việc dọn đơn quá hạn đều đọc từ đây.
 */
const MINUTE = 60 * 1000;

/** Đặt trước tối đa 5 giờ. */
export const MAX_AHEAD_MS = 5 * 60 * MINUTE;
/** Đơn chờ cọc giữ suất 15 phút kể từ lúc tạo. */
export const HOLD_MS = 15 * MINUTE;
/** Được vào bãi từ 30 phút trước đến 30 phút sau giờ hẹn; quá thì NoShow. */
export const ENTRY_WINDOW_MS = 30 * MINUTE;
/** Đổi giờ: chỉ một lần, trước giờ hẹn cũ ít nhất 15 phút. */
export const CHANGE_MIN_BEFORE_MS = 15 * MINUTE;
/** Huỷ trước giờ hẹn ít nhất 30 phút thì hoàn 100% cọc vào ví; muộn hơn thì mất cọc. */
export const REFUND_MIN_BEFORE_MS = 30 * MINUTE;
/** Tỉ lệ chỗ vãng lai của bãi được nhận đặt trước trong cùng khung giờ. */
export const QUOTA_RATIO = 0.2;

export const OPEN_STATUSES = ['Pending', 'Confirmed', 'Modified'] as const;
export const HELD_STATUSES = ['Confirmed', 'Modified'] as const;

export const is = (status: string | null | undefined, expected: string) =>
  (status ?? '').trim().toLowerCase() === expected.toLowerCase();

export const isHeld = (status: string) => HELD_STATUSES.some((s) => is(status, s));

export function holdExpiresAt(createdAt: Date | null | undefined): Date | null {
  return createdAt ? new Date(createdAt.getTime() + HOLD_MS) : null;
}

/** Đơn Pending đã hết thời gian giữ suất. Không có createdAt thì coi như hết hạn. */
export function isHoldExpired(createdAt: Date | null | undefined, now: Date): boolean {
  const until = holdExpiresAt(createdAt);
  return !until || now > until;
}

export function entryWindow(expected: Date) {
  return {
    from: new Date(expected.getTime() - ENTRY_WINDOW_MS),
    until: new Date(expected.getTime() + ENTRY_WINDOW_MS),
  };
}

export function inEntryWindow(expected: Date, now: Date): boolean {
  const { from, until } = entryWindow(expected);
  return now >= from && now <= until;
}

/** Lỗi khi chọn giờ vào (tạo mới hoặc đổi giờ); null nếu hợp lệ. */
export function entryTimeError(expected: Date, now: Date): string | null {
  if (expected <= now) return 'Giờ vào phải sau thời điểm hiện tại';
  if (expected.getTime() > now.getTime() + MAX_AHEAD_MS) return 'Chỉ được đặt trước tối đa 5 tiếng';
  return null;
}

/**
 * Hai đơn tranh cùng một suất khi khung vào bãi của chúng chồng nhau
 * (giờ hẹn cách nhau dưới 2 × 30 phút).
 */
export function overlapRange(expected: Date) {
  return {
    gt: new Date(expected.getTime() - 2 * ENTRY_WINDOW_MS),
    lt: new Date(expected.getTime() + 2 * ENTRY_WINDOW_MS),
  };
}

export function quotaOf(walkInCapacity: number): number {
  return walkInCapacity > 0 ? Math.max(1, Math.floor(walkInCapacity * QUOTA_RATIO)) : 0;
}

export function refundOnCancel(expected: Date, now: Date): boolean {
  return now.getTime() <= expected.getTime() - REFUND_MIN_BEFORE_MS;
}

export function changeTimeError(
  status: string,
  expected: Date,
  now: Date,
): string | null {
  if (is(status, 'Modified')) return 'Đơn này đã đổi giờ một lần, không đổi thêm được';
  if (!is(status, 'Confirmed')) return 'Chỉ đơn đã cọc mới được đổi giờ';
  if (now.getTime() > expected.getTime() - CHANGE_MIN_BEFORE_MS) {
    return 'Phải đổi giờ trước giờ hẹn cũ ít nhất 15 phút';
  }
  return null;
}

/** Staff / quản lý chỉ được chuyển trạng thái theo các bước này; vào bãi / hoàn tất do cổng ghi. */
const STAFF_TRANSITIONS: Record<string, string[]> = {
  pending: ['Cancelled'],
  confirmed: ['Cancelled', 'NoShow'],
  modified: ['Cancelled', 'NoShow'],
};

export function staffTransitionError(from: string, to: string): string | null {
  const allowed = STAFF_TRANSITIONS[from.trim().toLowerCase()] ?? [];
  if (allowed.some((s) => is(to, s))) return null;
  return allowed.length
    ? `Đơn ${from} chỉ chuyển được sang ${allowed.join(' hoặc ')}`
    : `Đơn ${from} đã kết thúc, không đổi trạng thái được`;
}

/** Giờ Việt Nam (UTC+7) không có giờ mùa hè: ngày "YYYY-MM-DD" bắt đầu lúc 17:00 UTC hôm trước. */
export function vietnamDayRange(date: string): { gte: Date; lt: Date } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) return null;
  const start = new Date(`${date.trim()}T00:00:00+07:00`);
  if (Number.isNaN(start.getTime())) return null;
  return { gte: start, lt: new Date(start.getTime() + 24 * 60 * MINUTE) };
}
