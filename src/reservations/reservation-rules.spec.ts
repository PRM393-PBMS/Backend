import {
  changeTimeError,
  entryTimeError,
  inEntryWindow,
  isHoldExpired,
  overlapRange,
  quotaOf,
  refundOnCancel,
  staffTransitionError,
  vietnamDayRange,
} from './reservation-rules';

const now = new Date('2026-11-02T03:00:00Z');
const min = (m: number) => new Date(now.getTime() + m * 60_000);

describe('quy tắc đặt chỗ', () => {
  it('giờ vào: sau hiện tại, tối đa 5 tiếng', () => {
    expect(entryTimeError(min(0), now)).toContain('sau thời điểm hiện tại');
    expect(entryTimeError(min(300), now)).toBeNull();
    expect(entryTimeError(min(301), now)).toContain('tối đa 5 tiếng');
  });

  it('giữ suất chờ cọc 15 phút', () => {
    expect(isHoldExpired(min(-15), now)).toBe(false);
    expect(isHoldExpired(min(-16), now)).toBe(true);
    expect(isHoldExpired(null, now)).toBe(true);
  });

  it('khung vào bãi ±30 phút quanh giờ hẹn', () => {
    expect(inEntryWindow(min(30), now)).toBe(true);
    expect(inEntryWindow(min(-30), now)).toBe(true);
    expect(inEntryWindow(min(31), now)).toBe(false);
    expect(inEntryWindow(min(-31), now)).toBe(false);
  });

  it('hai đơn tranh suất khi giờ hẹn cách nhau dưới 60 phút', () => {
    const range = overlapRange(now);
    expect(range.gt).toEqual(min(-60));
    expect(range.lt).toEqual(min(60));
  });

  it('hạn mức 20% chỗ vãng lai, ít nhất 1 khi bãi có chỗ', () => {
    expect(quotaOf(0)).toBe(0);
    expect(quotaOf(3)).toBe(1);
    expect(quotaOf(40)).toBe(8);
  });

  it('huỷ trước giờ hẹn ít nhất 30 phút mới hoàn cọc', () => {
    expect(refundOnCancel(min(30), now)).toBe(true);
    expect(refundOnCancel(min(29), now)).toBe(false);
  });

  it('đổi giờ: một lần, đơn đã cọc, trước giờ hẹn 15 phút', () => {
    expect(changeTimeError('Confirmed', min(15), now)).toBeNull();
    expect(changeTimeError('Confirmed', min(14), now)).toContain('15 phút');
    expect(changeTimeError('Modified', min(60), now)).toContain('một lần');
    expect(changeTimeError('Pending', min(60), now)).toContain('đã cọc');
  });

  it('nhân viên chỉ huỷ hoặc đánh dấu không đến', () => {
    expect(staffTransitionError('Confirmed', 'NoShow')).toBeNull();
    expect(staffTransitionError('Modified', 'cancelled')).toBeNull();
    expect(staffTransitionError('Pending', 'Confirmed')).toContain('Cancelled');
    expect(staffTransitionError('Confirmed', 'CheckedIn')).not.toBeNull();
    expect(staffTransitionError('Completed', 'Cancelled')).toContain('đã kết thúc');
  });

  it('ngày theo giờ Việt Nam', () => {
    expect(vietnamDayRange('2026-11-02')).toEqual({
      gte: new Date('2026-11-01T17:00:00Z'),
      lt: new Date('2026-11-02T17:00:00Z'),
    });
    expect(vietnamDayRange('02/11/2026')).toBeNull();
  });
});
