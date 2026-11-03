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

const IMAGE_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.heic': 'image/heic',
};

/** Cấu hình Supabase Storage; null khi chưa đặt biến môi trường (máy dev lưu ra ổ đĩa). */
export function supabaseStorageConfig(env: NodeJS.ProcessEnv = process.env): {
  url: string;
  key: string;
  bucket: string;
} | null {
  const url = env.SUPABASE_URL?.trim().replace(/\/+$/, '') ?? '';
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? '';
  if (!url || !key) return null;
  return { url, key, bucket: env.SUPABASE_STORAGE_BUCKET?.trim() || 'pbms-uploads' };
}

/**
 * Lưu ảnh tải lên. Có cấu hình Supabase thì lưu vào Supabase Storage (bucket công khai, giữ qua các lần
 * deploy); không có thì ghi ra UPLOAD_DIR như trước. Ổ đĩa Render bị xoá mỗi lần deploy nên production cần Supabase.
 */
@Injectable()
export class FilesService {
  private bucketReady: Promise<void> | null = null;

  resolveUploadRoot(): string {
    return process.env.UPLOAD_DIR ?? './public/uploads';
  }

  async saveUpload(
    file: import('../common/uploaded-image').UploadedImage,
    requestBaseUrl: string,
    subfolder = '',
  ): Promise<{ imageUrl: string; fileName: string }> {
    const ext = extname(file.originalname || '').toLowerCase() || '.jpg';
    const fileName = `${randomUUID()}${ext}`;
    const storage = supabaseStorageConfig();
    if (storage) {
      const objectPath = subfolder ? `${subfolder}/${fileName}` : fileName;
      return { imageUrl: await this.uploadToSupabase(storage, objectPath, file, ext), fileName };
    }
    const root = this.resolveUploadRoot();
    const dir = subfolder ? join(root, subfolder) : root;
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, fileName), file.buffer);
    const publicPath = subfolder ? `uploads/${subfolder}/${fileName}` : `uploads/${fileName}`;
    const imageUrl = `${requestBaseUrl.replace(/\/$/, '')}/${publicPath}`;
    return { imageUrl, fileName };
  }

  private async uploadToSupabase(
    storage: { url: string; key: string; bucket: string },
    objectPath: string,
    file: import('../common/uploaded-image').UploadedImage,
    ext: string,
  ): Promise<string> {
    await this.ensureBucket(storage);
    const contentType = file.mimetype?.startsWith('image/') ? file.mimetype : IMAGE_TYPES[ext] ?? 'image/jpeg';
    const response = await fetch(`${storage.url}/storage/v1/object/${storage.bucket}/${objectPath}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${storage.key}`,
        apikey: storage.key,
        'Content-Type': contentType,
        // Tên tệp là UUID, không bao giờ ghi đè: cho trình duyệt và CDN giữ lâu.
        'Cache-Control': 'max-age=31536000',
      },
      body: new Uint8Array(file.buffer),
    });
    if (!response.ok) {
      const json = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
      throw new Error(`Không lưu được ảnh lên Supabase Storage: ${json.message || json.error || `HTTP ${response.status}`}`);
    }
    return `${storage.url}/storage/v1/object/public/${storage.bucket}/${objectPath}`;
  }

  /**
   * Tạo bucket công khai chỉ nhận ảnh ở lần tải đầu tiên (mỗi lần chạy server gọi một lần).
   * Bucket đã có thì Supabase báo lỗi trùng; bỏ qua, lỗi thật sẽ lộ ra ở bước tải ảnh.
   */
  private ensureBucket(storage: { url: string; key: string; bucket: string }): Promise<void> {
    this.bucketReady ??= fetch(`${storage.url}/storage/v1/bucket`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${storage.key}`, apikey: storage.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: storage.bucket,
        name: storage.bucket,
        public: true,
        file_size_limit: 10 * 1024 * 1024,
        allowed_mime_types: ['image/*'],
      }),
    }).then(
      () => undefined,
      () => {
        this.bucketReady = null;
      },
    );
    return this.bucketReady;
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
    // Mặc định về trang kết quả của chính máy chủ (Render tự đặt RENDER_EXTERNAL_URL).
    const base = (process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000').replace(/\/+$/, '');
    const returnUrl = process.env.PAYOS_RETURN_URL || `${base}/payment/success`;
    const cancelUrl = process.env.PAYOS_CANCEL_URL || `${base}/payment/cancel`;
    const amount = Math.round(Number(payment.amount));
    const prefix =
      payment.paymentType === 'CheckoutFee'
        ? 'PARK'
        : payment.paymentType === 'Deposit'
          ? 'RES'
          : payment.paymentType === 'WalletTopUp'
            ? 'WAL'
            : payment.paymentType === 'PrepaidCheckout'
              ? 'EXIT'
              : 'SUB';
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

  /**
   * Hỏi trực tiếp PayOS trạng thái đơn (không tin body webhook).
   * status: PENDING | PROCESSING | PAID | CANCELLED | EXPIRED.
   */
  async getPaymentStatus(orderCode: string): Promise<{ status: string; amount: number; amountPaid: number }> {
    const { clientId, apiKey } = this.requireConfig();
    const response = await fetch(
      `https://api-merchant.payos.vn/v2/payment-requests/${encodeURIComponent(orderCode)}`,
      { headers: { 'x-client-id': clientId, 'x-api-key': apiKey } },
    );
    const json = (await response.json()) as {
      code?: string;
      desc?: string;
      data?: { status?: string; amount?: number; amountPaid?: number };
    };
    if (!response.ok || json.code !== '00' || !json.data) {
      throw new Error(json.desc || 'Không tra cứu được trạng thái thanh toán PayOS');
    }
    return {
      status: String(json.data.status ?? 'PENDING').toUpperCase(),
      amount: Number(json.data.amount ?? 0),
      amountPaid: Number(json.data.amountPaid ?? 0),
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
