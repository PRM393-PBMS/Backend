import { isValidLicensePlate, normalizeLicensePlate } from './license-plate';
import { extractGuidFromQrPayload } from './qr.util';

describe('license plate helpers', () => {
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
