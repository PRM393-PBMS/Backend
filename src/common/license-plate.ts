// Common domestic car/motorbike plates, including older four-digit registrations.
// This checks structure, not whether the plate was issued or belongs to the driver.
const CANONICAL = /^[1-9][0-9](?:[A-Z]{1,2}|[A-Z][0-9])[0-9]{4,5}$/;
const FORMATTED =
  /^[1-9][0-9]-?[A-Z][A-Z0-9]?(?:-| )[0-9]{3}\.[0-9]{2}$|^[1-9][0-9]-?[A-Z][A-Z0-9]?(?:-| )[0-9]{4,5}$/;
export const PLATE_FORMAT_MESSAGE =
  'Biển số chưa đúng định dạng. Ví dụ: 11H-111.11 hoặc 59-X2 123.45';

export function normalizeLicensePlate(
  value: string | undefined | null,
): string {
  if (!value || !value.trim()) {
    return '';
  }
  if (!/^[A-Za-z0-9 .-]+$/.test(value.trim())) return value.trim();
  const raw = value.trim().toUpperCase();
  // Do not silently turn arbitrary punctuation into a valid plate.
  if (!CANONICAL.test(raw) && !FORMATTED.test(raw)) return raw;
  return raw.replace(/[ .-]/g, '');
}

export function isValidLicensePlate(value: string | undefined | null): boolean {
  return CANONICAL.test(normalizeLicensePlate(value));
}

export function isMotorbikeType(typeName: string | null | undefined): boolean {
  const normalized = (typeName ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .trim()
    .toLowerCase();
  return /^(xe may|xe dap|motorbike|motorcycle|bike|bicycle|e-bike|electric (motorbike|motorcycle|bike|bicycle))(\s|$)/.test(
    normalized,
  );
}
