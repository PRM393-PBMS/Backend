import { isValidLicensePlate, normalizeLicensePlate } from './license-plate';
import { extractGuidFromQrPayload } from './qr.util';

describe('license plate helpers', () => {
  it.each([
    '11H-111.11',
    '11H11111',
    '59-X2 123.45',
    '59X212345',
    '59-AA 123.45',
    '29A-1234',
  ])('accepts common or legacy plate structure: %s', (value) => {
    expect(isValidLicensePlate(value)).toBe(true);
  });
  it.each([
    'ABC123',
    '12345678',
    '11H@111.11',
    '11ß11111',
    '11H--111.11',
    '11H-11.111',
    '00A12345',
    '11H123',
    '11H1234567',
  ])(
    'rejects malformed input without stripping it into a valid plate: %s',
    (value) => {
      expect(isValidLicensePlate(value)).toBe(false);
      expect(isValidLicensePlate(normalizeLicensePlate(value))).toBe(false);
    },
  );
  it('normalizes plates to alphanumeric uppercase', () => {
    expect(normalizeLicensePlate('29A-123.45')).toBe('29A12345');
    expect(isValidLicensePlate('29A-123.45')).toBe(true);
    expect(isValidLicensePlate('abc')).toBe(false);
  });
});

describe('qr payload helpers', () => {
  it('extracts GUID from payload text', () => {
    const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    expect(extractGuidFromQrPayload(`ticket:${id}`)).toBe(id);
    expect(extractGuidFromQrPayload('not-a-guid')).toBeNull();
  });
});
