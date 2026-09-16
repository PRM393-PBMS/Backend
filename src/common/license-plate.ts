const NON_ALNUM = /[^A-Z0-9]/g;
const CANONICAL = /^[A-Z0-9]{4,15}$/;

export function normalizeLicensePlate(value: string | undefined | null): string {
  if (!value || !value.trim()) {
    return '';
  }
  return value.trim().toUpperCase().replace(NON_ALNUM, '');
}

export function isValidLicensePlate(value: string | undefined | null): boolean {
  return CANONICAL.test(normalizeLicensePlate(value));
}

export function isMotorbikeType(typeName: string | null | undefined): boolean {
  const normalized = (typeName ?? '').trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    normalized.includes('motor') ||
    normalized.includes('bike') ||
    normalized.includes('xe máy') ||
    normalized.includes('xe may')
  );
}
