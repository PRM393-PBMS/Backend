import QRCode from 'qrcode';
import { generateExitPassCode } from './exit-pass';

/** Mã vào bãi một lần còn hiệu lực trong 24 giờ kể từ lúc tạo. */
export const ENTRY_PASS_TTL_HOURS = 24;

const PREFIX = 'PBMS-ENTRY:';

/** Mã ngắn 6 ký tự (đọc được bằng mắt khi máy quét hỏng), cùng bảng chữ với mã ra cổng. */
export const generateEntryPassCode = generateExitPassCode;

export function entryPassPayload(passId: string, code: string): string {
  return `${PREFIX}${passId}:${code}`;
}

/** Tách payload QR "PBMS-ENTRY:<id>:<mã>"; không đúng dạng thì null. */
export function parseEntryPassPayload(payload: string | null | undefined): { passId: string; code: string } | null {
  const value = (payload ?? '').trim();
  if (!value.startsWith(PREFIX)) return null;
  const match = value
    .slice(PREFIX.length)
    .match(/^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}):([A-Z0-9]{4,12})$/);
  return match ? { passId: match[1].toLowerCase(), code: match[2] } : null;
}

/** Trạng thái thực tế: mã "Active" đã quá hạn thì coi là "Expired". */
export function effectiveEntryPassStatus(pass: { status: string; expiresAt: Date }, now = new Date()): string {
  return pass.status === 'Active' && pass.expiresAt <= now ? 'Expired' : pass.status;
}

export async function mapEntryPass(pass: {
  id: string;
  code: string;
  status: string;
  expiresAt: Date;
  createdAt: Date;
  usedAt: Date | null;
  sessionId: string | null;
  vehicle: {
    id: string;
    licensePlate: string;
    nickname?: string | null;
    vehicleType: { id?: string; typeName: string };
  };
}) {
  const status = effectiveEntryPassStatus(pass);
  const qrPayload = entryPassPayload(pass.id, pass.code);
  return {
    entryPassId: pass.id,
    code: pass.code,
    status,
    vehicleId: pass.vehicle.id,
    licensePlate: pass.vehicle.licensePlate,
    vehicleName: pass.vehicle.nickname ?? null,
    vehicleTypeName: pass.vehicle.vehicleType.typeName,
    createdAt: pass.createdAt,
    expiresAt: pass.expiresAt,
    usedAt: pass.usedAt,
    sessionId: pass.sessionId,
    // Chỉ trả QR khi mã còn dùng được.
    qrPayload: status === 'Active' ? qrPayload : null,
    qrCodeDataUrl:
      status === 'Active'
        ? await QRCode.toDataURL(qrPayload, { errorCorrectionLevel: 'Q', margin: 1, width: 256 })
        : null,
  };
}
