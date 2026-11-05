/** Shared rules for customer-entered names. Values are validated before normalization. */
export const PERSON_NAME = /^\p{L}[\p{L}\p{M}]*(?: +\p{L}[\p{L}\p{M}]*)*$/u;
export const VEHICLE_NAME =
  /^[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?: +[\p{L}\p{N}][\p{L}\p{M}\p{N}]*)*$/u;
export const MODEL_NAME = /^[\p{L}\p{N}][\p{L}\p{M}\p{N} .():+/-]*$/u;
export const PHONE_NUMBER = /^(0|\+84)[35789][0-9]{8}$/;

export function normalizeName(value: string): string {
  return value.normalize('NFC').trim().replace(/ +/g, ' ');
}

export function newPasswordError(value: string): string | null {
  if (!value.trim() || Array.from(value).length < 6)
    return 'Mật khẩu tối thiểu 6 ký tự, không chỉ có khoảng trắng';
  if (Buffer.byteLength(value, 'utf8') > 72)
    return 'Mật khẩu quá dài. Vui lòng dùng mật khẩu ngắn hơn.';
  return null;
}

export function validateFormText(key: string, raw: unknown): string | null {
  const name = key.toLowerCase();
  if (
    ![
      'fullname',
      'signername',
      'nickname',
      'modelname',
      'phonenumber',
    ].includes(name)
  )
    return null;
  if (typeof raw !== 'string')
    return 'Thông tin chưa đúng định dạng. Vui lòng kiểm tra lại.';
  if (/[\p{Cc}\p{Cf}]/u.test(raw))
    return 'Thông tin có ký tự không hợp lệ. Vui lòng xóa và nhập lại.';
  const value = normalizeName(raw);
  if (name === 'fullname' || name === 'signername') {
    if (!value) return 'Vui lòng nhập họ và tên';
    if (value.length > 100) return 'Họ và tên tối đa 100 ký tự';
    if (!PERSON_NAME.test(value))
      return 'Họ và tên chỉ gồm chữ cái và khoảng trắng, không có số hoặc ký tự đặc biệt';
  } else if (name === 'nickname') {
    if (value.length > 40) return 'Tên xe tối đa 40 ký tự';
    if (value && !VEHICLE_NAME.test(value))
      return 'Tên xe chỉ gồm chữ cái, chữ số và khoảng trắng';
  } else if (name === 'modelname') {
    if (value.length > 60) return 'Mẫu xe tối đa 60 ký tự';
    if (value && !MODEL_NAME.test(value))
      return 'Mẫu xe không được có ký tự đặc biệt không hợp lệ';
  } else if (!PHONE_NUMBER.test(value)) {
    return 'Số điện thoại không hợp lệ. Nhập 10 chữ số bắt đầu bằng 03, 05, 07, 08 hoặc 09, hoặc dùng +84';
  }
  return null;
}
