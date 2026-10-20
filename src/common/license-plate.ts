const NON_ALNUM = /[^A-Z0-9]/g;
const CANONICAL = /^[A-Z0-9]{4,15}$/;

export function normalizeLicensePlate(
  value: string | undefined | null,
): string {
  if (!value || !value.trim()) {
    return '';
  }
  return value.trim().toUpperCase().replace(NON_ALNUM, '');
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

export function isCarType(typeName: string | null | undefined): boolean {
  const normalized = (typeName ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
  return /^(o to|car)(\s|$)/.test(normalized) || normalized === 'electric car';
}
