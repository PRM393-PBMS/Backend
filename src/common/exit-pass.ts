import { randomInt } from 'crypto';
import QRCode from 'qrcode';
import { Db } from './transactions';
import { AppError } from './errors';
export const EXIT_GRACE_MS = 15 * 60 * 1000;
export function exitPassExpired(
  session: { prepaidAt: Date | null },
  now = new Date(),
): boolean {
  return (
    !session.prepaidAt ||
    now.getTime() > session.prepaidAt.getTime() + EXIT_GRACE_MS
  );
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Mã ra cổng 6 ký tự, bỏ các ký tự dễ nhầm (0/O, 1/I). */
export function generateExitPassCode(): string {
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }
  return code;
}

/**
 * Mã chữ 6 ký tự nhân viên gõ tay khi camera và máy quét QR đều không dùng được.
 * Trả về mã đã chuẩn hoá (in hoa, bỏ khoảng trắng / gạch) hoặc null nếu không đúng dạng.
 */
export function parseShortGateCode(value: string | null | undefined): string | null {
  const code = (value ?? '').toUpperCase().replace(/[\s-]/g, '');
  return new RegExp(`^[${ALPHABET}]{6}$`).test(code) ? code : null;
}

/**
 * Payload QR của mã ra cổng. Chứa SessionId nên đầu đọc ở cổng ra
 * (resolveSessionId) nhận diện được như vé thường.
 */
export function exitPassPayload(sessionId: string, code: string): string {
  return `PBMS-EXIT:${sessionId}:${code}`;
}

/** Ghi nhận đã thanh toán trước và cấp mã ra cổng (giữ mã cũ nếu đã có). */
export async function issueExitPass(
  prisma: Db,
  sessionId: string,
  now = new Date(),
): Promise<string> {
  const session = await prisma.parkingSession.findUnique({
    where: { id: sessionId },
  });
  if (!session) {
    throw new AppError(
      409,
      'SESSION_MISSING',
      `Không tìm thấy phiên gửi xe ${sessionId} để cấp mã ra cổng.`,
    );
  }
  if (session.status !== 'Active')
    throw new AppError(
      409,
      'SESSION_CLOSED',
      'Phiên đã kết thúc, thanh toán cần đối soát',
    );
  if (session.exitPassCode && !exitPassExpired(session, now)) {
    return session.exitPassCode;
  }
  const code = generateExitPassCode();
  await prisma.parkingSession.update({
    where: { id: sessionId },
    data: { prepaidAt: now, exitPassCode: code },
  });
  return code;
}

export async function mapExitPass(session: {
  id: string;
  status: string;
  prepaidAt: Date | null;
  exitPassCode: string | null;
}) {
  if (!session.exitPassCode || session.status.toLowerCase() !== 'active') {
    return null;
  }
  const qrPayload = exitPassPayload(session.id, session.exitPassCode);
  return {
    code: session.exitPassCode,
    qrPayload,
    qrCodeDataUrl: await QRCode.toDataURL(qrPayload, {
      errorCorrectionLevel: 'Q',
      margin: 1,
      width: 256,
    }).catch(() => null),
    prepaidAt: session.prepaidAt,
    expiresAt: session.prepaidAt
      ? new Date(session.prepaidAt.getTime() + EXIT_GRACE_MS)
      : null,
    isExpired: exitPassExpired(session),
  };
}
