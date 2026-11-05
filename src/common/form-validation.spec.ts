import {
  newPasswordError,
  normalizeName,
  validateFormText,
} from './form-validation';

describe('customer form validation', () => {
  it.each([
    'Nguyễn Văn An',
    'Đỗ Mỹ Hạnh',
    'Nguye\u0302\u0303n Va\u0306n An',
    '李明',
  ])('accepts a real Unicode name: %s', (value) => {
    expect(validateFormText('fullName', value)).toBeNull();
  });
  it.each([
    '',
    'An123',
    'An@',
    '<script>',
    'An😀',
    'An\nBình',
    'An\u200bBình',
    '́',
  ])('rejects invalid personal names: %s', (value) => {
    expect(validateFormText('fullName', value)).toBeTruthy();
  });
  it('normalizes spaces and permits digits only for vehicle labels', () => {
    expect(normalizeName('  Xe   của mẹ  ')).toBe('Xe của mẹ');
    expect(validateFormText('nickname', 'Xe số 1')).toBeNull();
    expect(validateFormText('nickname', 'Xe@nhà')).toBeTruthy();
    expect(validateFormText('modelName', 'Mazda CX-5')).toBeNull();
    expect(validateFormText('modelName', 'Honda SH 125i')).toBeNull();
    expect(validateFormText('modelName', 'Honda CR-V e:HEV')).toBeNull();
    expect(validateFormText('modelName', '<Honda>')).toBeTruthy();
    expect(validateFormText('nickname', '')).toBeNull();
    expect(validateFormText('nickname', 'a'.repeat(41))).toBeTruthy();
  });
  it.each(['0912345678', '+84912345678', '0351234567'])(
    'accepts supported phones: %s',
    (value) => {
      expect(validateFormText('phoneNumber', value)).toBeNull();
    },
  );
  it.each(['0123456789', '091234567', '09123456789', '09a2345678'])(
    'rejects invalid phones: %s',
    (value) => {
      expect(validateFormText('phoneNumber', value)).toBeTruthy();
    },
  );
  it('checks password bytes before bcrypt can truncate Unicode input', () => {
    expect(newPasswordError('a'.repeat(72))).toBeNull();
    expect(newPasswordError('á'.repeat(36))).toBeNull();
    expect(newPasswordError('á'.repeat(37))).toBeTruthy();
    expect(newPasswordError('      ')).toBeTruthy();
    expect(newPasswordError('12345')).toBeTruthy();
    expect(newPasswordError('😀'.repeat(3))).toBeTruthy();
  });
});
