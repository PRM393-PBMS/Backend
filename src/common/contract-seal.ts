import { createHash, createPrivateKey, createPublicKey, KeyObject, sign, verify } from 'crypto';

/** Gói vé từ 3 tháng trở lên (3, 6, 9, 12) bắt buộc ký hợp đồng trước khi thanh toán. */
export const CONTRACT_MIN_MONTHS = 3;

export function requiresContract(durationMonths: number): boolean {
  return durationMonths >= CONTRACT_MIN_MONTHS;
}

export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export type SealFields = {
  contractNumber: string;
  contentHash: string;
  signatureImageHash: string;
  signedAt: Date;
  userId: string;
};

/** Chuỗi được niêm phong. Thứ tự và định dạng cố định để kiểm tra lại được về sau. */
export function sealPayload(f: SealFields): string {
  return [
    'PBMS-CONTRACT',
    'v1',
    f.contractNumber,
    f.contentHash,
    f.signatureImageHash,
    f.signedAt.toISOString(),
    f.userId,
  ].join('|');
}

export type SealKey = { privateKey: KeyObject; publicKey: KeyObject; keyId: string };

/** Mã khoá = 16 ký tự hex đầu của SHA-256 khoá công khai (SPKI DER). */
export function keyIdOf(publicKey: KeyObject): string {
  return sha256Hex(publicKey.export({ type: 'spki', format: 'der' })).slice(0, 16);
}

export function sealKeyFromPem(pem: string): SealKey {
  const privateKey = createPrivateKey(pem.replace(/\\n/g, '\n'));
  if (privateKey.asymmetricKeyType !== 'ec') {
    throw new Error('Khoá ký hợp đồng phải là khoá EC (P-256)');
  }
  const publicKey = createPublicKey(privateKey);
  return { privateKey, publicKey, keyId: keyIdOf(publicKey) };
}

/** Khoá ký lấy từ biến môi trường CONTRACT_SIGNING_PRIVATE_KEY (PEM PKCS#8). */
export function loadSealKey(): SealKey | null {
  const pem = process.env.CONTRACT_SIGNING_PRIVATE_KEY?.trim();
  return pem ? sealKeyFromPem(pem) : null;
}

export function signSeal(payload: string, key: SealKey): string {
  return sign('sha256', Buffer.from(payload, 'utf8'), key.privateKey).toString('base64');
}

export function verifySeal(payload: string, seal: string, publicKey: KeyObject): boolean {
  try {
    return verify('sha256', Buffer.from(payload, 'utf8'), publicKey, Buffer.from(seal, 'base64'));
  } catch {
    return false;
  }
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const SIGNATURE_MAX_BYTES = 200 * 1024;

/** Giải mã ảnh chữ ký PNG (chấp nhận tiền tố data:image/png;base64,). */
export function decodeSignaturePng(raw: string): Buffer | null {
  const base64 = raw.trim().replace(/^data:image\/png;base64,/, '');
  if (!base64 || !/^[A-Za-z0-9+/]+=*$/.test(base64)) {
    return null;
  }
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length < 100 || bytes.length > SIGNATURE_MAX_BYTES) {
    return null;
  }
  return bytes.subarray(0, 8).equals(PNG_MAGIC) ? bytes : null;
}
