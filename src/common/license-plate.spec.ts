import { isCarType, isMotorbikeType, isValidLicensePlate, normalizeLicensePlate } from './license-plate';
import { extractGuidFromQrPayload } from './qr.util';

describe('license plate helpers', () => {
  it.each(['Xe máy', 'Xe máy điện', 'XE ĐẠP ĐIỆN', 'xe may dien', 'Electric motorcycle'])('recognizes free parking for %s', (type) => {
    expect(isMotorbikeType(type)).toBe(true);
    expect(isCarType(type)).toBe(false);
  });

  it.each(['Ô tô', 'Ô tô điện', 'O to dien', 'Electric car'])('recognizes assigned parking for %s', (type) => {
    expect(isCarType(type)).toBe(true);
    expect(isMotorbikeType(type)).toBe(false);
  });

  it.each([null, undefined, '', 'Xe điện', 'motorcar'])('does not guess ambiguous type %s', (type) => {
    expect(isMotorbikeType(type)).toBe(false);
    expect(isCarType(type)).toBe(false);
  });
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
