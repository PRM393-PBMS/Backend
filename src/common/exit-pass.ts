import { randomInt } from 'crypto';
import QRCode from 'qrcode';
import { PrismaService } from '../prisma/prisma.service';

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
 * Payload QR của mã ra cổng. Chứa SessionId nên đầu đọc ở cổng ra
 * (resolveSessionId) nhận diện được như vé thường.
 */
export function exitPassPayload(sessionId: string, code: string): string {
  return `PBMS-EXIT:${sessionId}:${code}`;
}

/** Ghi nhận đã thanh toán trước và cấp mã ra cổng (giữ mã cũ nếu đã có). */
export async function issueExitPass(prisma: PrismaService, sessionId: string): Promise<string> {
  const session = await prisma.parkingSession.findUnique({ where: { id: sessionId } });
  if (!session) {
    throw new Error(`Không tìm thấy phiên gửi xe ${sessionId} để cấp mã ra cổng.`);
  }
  if (session.exitPassCode) {
    return session.exitPassCode;
  }
  const code = generateExitPassCode();
  await prisma.parkingSession.update({
    where: { id: sessionId },
    data: { prepaidAt: new Date(), exitPassCode: code },
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
    qrCodeDataUrl: await QRCode.toDataURL(qrPayload, { errorCorrectionLevel: 'Q', margin: 1, width: 256 }),
    prepaidAt: session.prepaidAt,
  };
}
