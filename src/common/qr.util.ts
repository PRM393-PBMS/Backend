import QRCode from 'qrcode';

export async function createTicket(id: string): Promise<{
  qrPayload: string;
  qrCodeDataUrl: string;
}> {
  const qrPayload = id;
  const qrCodeDataUrl = await QRCode.toDataURL(qrPayload, {
    errorCorrectionLevel: 'Q',
    margin: 1,
    width: 256,
  });
  return { qrPayload, qrCodeDataUrl };
}

export function extractGuidFromQrPayload(payload: string | undefined | null): string | null {
  if (!payload) {
    return null;
  }
  const match = payload
    .trim()
    .match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
  return match ? match[0] : null;
}
