import { Injectable } from '@nestjs/common';
import { createHmac, randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { mkdir, writeFile } from 'fs/promises';
import { extname, join } from 'path';

export type PayosLinkResult = {
  paymentUrl: string;
  paymentLinkId: string;
  qrCode: string;
  orderCode: string;
};

@Injectable()
export class FilesService {
  resolveUploadRoot(): string {
    return process.env.UPLOAD_DIR ?? './public/uploads';
  }

  async saveUpload(
    file: import('../common/uploaded-image').UploadedImage,
    requestBaseUrl: string,
    subfolder = '',
  ): Promise<{ imageUrl: string; fileName: string }> {
    const root = this.resolveUploadRoot();
    const dir = subfolder ? join(root, subfolder) : root;
    await mkdir(dir, { recursive: true });
    const ext = extname(file.originalname || '').toLowerCase() || '.jpg';
    const fileName = `${randomUUID()}${ext}`;
    await writeFile(join(dir, fileName), file.buffer);
    const publicPath = subfolder ? `uploads/${subfolder}/${fileName}` : `uploads/${fileName}`;
    const imageUrl = `${requestBaseUrl.replace(/\/$/, '')}/${publicPath}`;
    return { imageUrl, fileName };
  }
}

@Injectable()
export class PayosService {
  private requireConfig(): { clientId: string; apiKey: string; checksumKey: string } {
    const clientId = process.env.PAYOS_CLIENT_ID?.trim() ?? '';
    const apiKey = process.env.PAYOS_API_KEY?.trim() ?? '';
    const checksumKey = process.env.PAYOS_CHECKSUM_KEY?.trim() ?? '';
    if (!clientId || !apiKey || !checksumKey) {
      throw new Error('Thiếu cấu hình PayOS (PAYOS_CLIENT_ID, PAYOS_API_KEY, PAYOS_CHECKSUM_KEY)');
    }
    return { clientId, apiKey, checksumKey };
  }

  async createPaymentLink(payment: {
    id: string;
    amount: Prisma.Decimal | number;
    paymentType: string | null;
  }): Promise<PayosLinkResult> {
    const { clientId, apiKey, checksumKey } = this.requireConfig();
    const orderCode = Date.now();
    const returnUrl = process.env.PAYOS_RETURN_URL ?? 'http://localhost:5173/payment-success';
    const cancelUrl = process.env.PAYOS_CANCEL_URL ?? 'http://localhost:5173/payment-cancel';
    const amount = Math.round(Number(payment.amount));
    const prefix =
      payment.paymentType === 'CheckoutFee' ? 'PARK' : payment.paymentType === 'Deposit' ? 'RES' : 'SUB';
    const description = `${prefix}-${payment.id.replace(/-/g, '').slice(0, 8)}`.slice(0, 25);
    const signature = this.signCreate(checksumKey, {
      amount,
      cancelUrl,
      description,
      orderCode,
      returnUrl,
    });

    const response = await fetch('https://api-merchant.payos.vn/v2/payment-requests', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': clientId,
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        orderCode,
        amount,
        description,
        returnUrl,
        cancelUrl,
        signature,
      }),
    });
    const json = (await response.json()) as {
      code?: string;
      desc?: string;
      data?: { checkoutUrl?: string; paymentLinkId?: string; qrCode?: string };
    };
    if (!response.ok || json.code !== '00' || !json.data?.checkoutUrl) {
      throw new Error(json.desc || 'Không tạo được liên kết thanh toán PayOS');
    }
    return {
      paymentUrl: json.data.checkoutUrl,
      paymentLinkId: json.data.paymentLinkId ?? json.data.checkoutUrl.split('/').pop() ?? '',
      qrCode: json.data.qrCode ?? '',
      orderCode: String(orderCode),
    };
  }

  async cancelPaymentLink(orderCode: string): Promise<void> {
    const { clientId, apiKey } = this.requireConfig();
    const response = await fetch(
      `https://api-merchant.payos.vn/v2/payment-requests/${encodeURIComponent(orderCode)}/cancel`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-client-id': clientId,
          'x-api-key': apiKey,
        },
        body: JSON.stringify({ cancellationReason: 'Nhân viên hủy checkout' }),
      },
    );
    if (!response.ok) {
      const json = (await response.json().catch(() => ({}))) as { desc?: string };
      throw new Error(json.desc || 'Không hủy được liên kết thanh toán PayOS');
    }
  }

  async getPaymentLink(orderCode: string): Promise<PayosLinkResult> {
    const { clientId, apiKey } = this.requireConfig();
    const response = await fetch(
      `https://api-merchant.payos.vn/v2/payment-requests/${encodeURIComponent(orderCode)}`,
      {
        headers: {
          'x-client-id': clientId,
          'x-api-key': apiKey,
        },
      },
    );
    const json = (await response.json()) as {
      code?: string;
      desc?: string;
      data?: { id?: string; checkoutUrl?: string; qrCode?: string };
    };
    if (!response.ok || json.code !== '00') {
      throw new Error(json.desc || 'Không tải được liên kết thanh toán PayOS');
    }
    const paymentLinkId = json.data?.id ?? '';
    return {
      paymentUrl: json.data?.checkoutUrl ?? `https://pay.payos.vn/web/${paymentLinkId}`,
      paymentLinkId,
      qrCode: json.data?.qrCode ?? '',
      orderCode,
    };
  }

  private signCreate(
    checksumKey: string,
    payload: {
      amount: number;
      cancelUrl: string;
      description: string;
      orderCode: number;
      returnUrl: string;
    },
  ): string {
    const data = `amount=${payload.amount}&cancelUrl=${payload.cancelUrl}&description=${payload.description}&orderCode=${payload.orderCode}&returnUrl=${payload.returnUrl}`;
    return createHmac('sha256', checksumKey).update(data).digest('hex');
  }
}
