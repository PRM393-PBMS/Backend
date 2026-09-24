/**
 * Đọc field JSON theo cả camelCase và PascalCase (client PBMS gửi cả hai).
 */
export function pbmsPick(body: object, ...keys: string[]): string {
  const rec = body as Record<string, unknown>;
  for (const key of keys) {
    const value = rec[key];
    if (typeof value === 'string') {
      return value;
    }
  }
  return '';
}

export function pbmsPickGuid(body: object, ...keys: string[]): string {
  const rec = body as Record<string, unknown>;
  for (const key of keys) {
    const value = rec[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

export function pbmsPickNumber(body: object, ...keys: string[]): number | undefined {
  const rec = body as Record<string, unknown>;
  for (const key of keys) {
    const value = rec[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return undefined;
}

export function pbmsPickBool(body: object, ...keys: string[]): boolean | undefined {
  const rec = body as Record<string, unknown>;
  for (const key of keys) {
    const value = rec[key];
    if (typeof value === 'boolean') {
      return value;
    }
  }
  return undefined;
}

export function parseRoleId(id: string | number | undefined | null): number | null {
  if (typeof id === 'number' && Number.isInteger(id) && id > 0) {
    return id;
  }
  if (typeof id === 'string' && /^\d+$/.test(id.trim())) {
    const n = Number(id.trim());
    return n > 0 ? n : null;
  }
  return null;
}

export function isEmptyGuid(id: string | undefined | null): boolean {
  if (!id || !id.trim()) {
    return true;
  }
  return id.trim() === '00000000-0000-0000-0000-000000000000';
}

export function toMoney(value: { toString(): string } | number | null | undefined): number {
  if (value === null || value === undefined) {
    return 0;
  }
  return typeof value === 'number' ? value : Number(value.toString());
}

export function pbmsPickDate(body: object | unknown, ...keys: string[]): Date | undefined {
  if (body instanceof Date && !Number.isNaN(body.getTime())) {
    return body;
  }
  if (typeof body === 'string' && body.trim()) {
    const parsed = new Date(body);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  if (!body || typeof body !== 'object') {
    return undefined;
  }
  const rec = body as Record<string, unknown>;
  for (const key of keys) {
    const value = rec[key];
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value;
    }
    if (typeof value === 'string' && value.trim()) {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed;
      }
    }
  }
  return undefined;
}

export function sameStatus(left: string | null | undefined, right: string): boolean {
  return (left ?? '').trim().toLowerCase() === right.trim().toLowerCase();
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'unknown';
}
