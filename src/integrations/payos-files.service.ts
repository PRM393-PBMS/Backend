import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/errors';
import { upstreamJson } from '../common/upstream';
import { timingSafeEqual, randomInt } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { createHmac, randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';

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
  return {
    url,
    key,
    bucket: env.SUPABASE_STORAGE_BUCKET?.trim() || 'pbms-uploads',
  };
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
    if (!file?.buffer?.length)
      throw new AppError(400, 'EMPTY_FILE', 'Vui lòng chọn ảnh');
    if (file.buffer.length > 5 * 1024 * 1024)
      throw new AppError(413, 'FILE_TOO_LARGE', 'Ảnh tối đa 5 MiB');
    let metadata: sharp.Metadata;
    try {
      metadata = await sharp(file.buffer, {
        limitInputPixels: 20_000_000,
      }).metadata();
      // Reject truncated/corrupt pixel data even when its header parses.
      if (['jpeg', 'png', 'webp'].includes(metadata.format ?? ''))
        await sharp(file.buffer, {
          limitInputPixels: 20_000_000,
          failOn: 'warning',
        }).stats();
    } catch {
      throw new AppError(
        415,
        'INVALID_IMAGE',
        'Ảnh không hợp lệ hoặc vượt giới hạn 20 triệu pixel',
      );
    }
    if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? ''))
      throw new AppError(
        415,
        'UNSUPPORTED_IMAGE',
        'Chỉ hỗ trợ JPEG, PNG hoặc WebP',
      );
    const ext = '.' + (metadata.format === 'jpeg' ? 'jpg' : metadata.format);
    const fileName = `${randomUUID()}${ext}`;
    const storage = supabaseStorageConfig();
    if (storage) {
      const objectPath = subfolder ? `${subfolder}/${fileName}` : fileName;
      return {
        imageUrl: await this.uploadToSupabase(storage, objectPath, file, ext),
        fileName,
      };
    }
    const root = this.resolveUploadRoot();
    const dir = subfolder ? join(root, subfolder) : root;
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, fileName), file.buffer);
    const publicPath = subfolder
      ? `uploads/${subfolder}/${fileName}`
      : `uploads/${fileName}`;
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
    const contentType = file.mimetype?.startsWith('image/')
      ? file.mimetype
      : (IMAGE_TYPES[ext] ?? 'image/jpeg');
    const response = await fetch(
      `${storage.url}/storage/v1/object/${storage.bucket}/${objectPath}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${storage.key}`,
          apikey: storage.key,
          'Content-Type': contentType,
          // Tên tệp là UUID, không bao giờ ghi đè: cho trình duyệt và CDN giữ lâu.
          'Cache-Control': 'max-age=31536000',
        },
        body: new Uint8Array(file.buffer),
      },
    );
    if (!response.ok) {
      const json = (await response.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
      };
      throw new Error(
        `Không lưu được ảnh lên Supabase Storage: ${json.message || json.error || `HTTP ${response.status}`}`,
      );
    }
    return `${storage.url}/storage/v1/object/public/${storage.bucket}/${objectPath}`;
  }

  /**
   * Tạo bucket công khai chỉ nhận ảnh ở lần tải đầu tiên (mỗi lần chạy server gọi một lần).
   * Bucket đã có thì Supabase báo lỗi trùng; bỏ qua, lỗi thật sẽ lộ ra ở bước tải ảnh.
   */
  private ensureBucket(storage: {
    url: string;
    key: string;
    bucket: string;
  }): Promise<void> {
    this.bucketReady ??= fetch(`${storage.url}/storage/v1/bucket`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${storage.key}`,
        apikey: storage.key,
        'Content-Type': 'application/json',
      },
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
  constructor(private readonly prisma: PrismaService) {}

  verifyWebhook(body: Record<string, unknown>): void {
    const { checksumKey } = this.requireConfig();
    const data = body.data;
    if (
      !data ||
      typeof data !== 'object' ||
      Array.isArray(data) ||
      typeof body.signature !== 'string' ||
      !/^[a-f0-9]{64}$/i.test(body.signature)
    )
      throw new AppError(400, 'INVALID_WEBHOOK', 'Webhook PayOS không hợp lệ');
    const record = data as Record<string, unknown>;
    const canonical = Object.keys(record)
      .sort()
      .map((key) => {
        const value = record[key];
        const text =
          value == null || value === 'null' || value === 'undefined'
            ? ''
            : typeof value === 'object'
              ? JSON.stringify(value)
              : String(value);
        return `${key}=${text}`;
      })
      .join('&');
    const expected = createHmac('sha256', checksumKey)
      .update(canonical)
      .digest();
    if (!timingSafeEqual(expected, Buffer.from(body.signature, 'hex')))
      throw new AppError(
        400,
        'INVALID_WEBHOOK_SIGNATURE',
        'Chữ ký webhook PayOS không hợp lệ',
      );
  }

  private async request(path: string, init: RequestInit = {}) {
    const { clientId, apiKey } = this.requireConfig();
    const json = await upstreamJson(
      `https://api-merchant.payos.vn/v2/payment-requests${path}`,
      {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          'x-client-id': clientId,
          'x-api-key': apiKey,
          ...init.headers,
        },
      },
    );
    if (json.code === '201')
      throw new AppError(
        502,
        'PAYOS_ORDER_NOT_FOUND',
        'Chưa tìm thấy đơn thanh toán PayOS',
      );
    if (json.code !== '00' || !json.data || typeof json.data !== 'object')
      throw new AppError(
        502,
        'PAYOS_REJECTED',
        'PayOS chưa xử lý được yêu cầu',
      );
    return json.data;
  }
  private requireConfig(): {
    clientId: string;
    apiKey: string;
    checksumKey: string;
  } {
    const clientId = process.env.PAYOS_CLIENT_ID?.trim() ?? '';
    const apiKey = process.env.PAYOS_API_KEY?.trim() ?? '';
    const checksumKey = process.env.PAYOS_CHECKSUM_KEY?.trim() ?? '';
    if (!clientId || !apiKey || !checksumKey) {
      throw new AppError(
        503,
        'PAYOS_NOT_CONFIGURED',
        'Dịch vụ thanh toán chưa được cấu hình',
      );
    }
    return { clientId, apiKey, checksumKey };
  }

  async createPaymentLink(payment: {
    id: string;
    amount: Prisma.Decimal | number;
    paymentType: string | null;
  }): Promise<PayosLinkResult> {
    const { checksumKey } = this.requireConfig();
    const stored = await this.prisma.payment.findUniqueOrThrow({
      where: { id: payment.id },
    });
    if (stored.paymentMethod !== 'PayOS' || stored.paymentStatus !== 'Pending')
      throw new AppError(
        409,
        'PAYMENT_CLOSED',
        'Thanh toán không còn ở trạng thái chờ',
      );
    let reference = stored.transactionReference;
    let isNew = false;
    if (!reference) {
      const candidate = String(randomInt(1, 281474976710655));
      const claimed = await this.prisma.payment.updateMany({
        where: {
          id: payment.id,
          paymentStatus: 'Pending',
          OR: [{ transactionReference: null }, { transactionReference: '' }],
        },
        data: { transactionReference: candidate },
      });
      isNew = claimed.count === 1;
      reference = (
        await this.prisma.payment.findUniqueOrThrow({
          where: { id: payment.id },
        })
      ).transactionReference;
    }
    if (!reference)
      throw new AppError(409, 'PAYMENT_PENDING', 'Thanh toán đang được xử lý');
    const orderCode = Number(reference);
    const base = (
      process.env.PUBLIC_BASE_URL ||
      process.env.RENDER_EXTERNAL_URL ||
      'http://localhost:3000'
    ).replace(/\/+$/, '');
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
    const description =
      `${prefix}-${payment.id.replace(/-/g, '').slice(0, 8)}`.slice(0, 25);
    const signature = this.signCreate(checksumKey, {
      amount,
      cancelUrl,
      description,
      orderCode,
      returnUrl,
    });

    // Reuse the durable order after an uncertain create; no second financial order.
    let data: Record<string, any>;
    if (isNew) {
      data = await this.request('', {
        method: 'POST',
        body: JSON.stringify({
          orderCode,
          amount,
          description,
          returnUrl,
          cancelUrl,
          signature,
        }),
      });
    } else {
      // Existing durable order: lookup only. Unknown outcomes must not create another charge.
      try {
        data = await this.request('/' + orderCode);
      } catch (error) {
        if (
          !(error instanceof AppError) ||
          (error.getResponse() as { errorCode?: string }).errorCode !==
            'PAYOS_ORDER_NOT_FOUND'
        )
          throw error;
        data = await this.request('', {
          method: 'POST',
          body: JSON.stringify({
            orderCode,
            amount,
            description,
            returnUrl,
            cancelUrl,
            signature,
          }),
        });
      }
    }
    if (!data.checkoutUrl)
      throw new AppError(
        502,
        'PAYOS_INVALID_RESPONSE',
        'PayOS trả về liên kết không hợp lệ',
      );
    return {
      paymentUrl: data.checkoutUrl,
      paymentLinkId:
        data.paymentLinkId ?? data.checkoutUrl.split('/').pop() ?? '',
      qrCode: data.qrCode ?? '',
      orderCode: String(orderCode),
    };
  }

  async cancelPaymentLink(orderCode: string): Promise<void> {
    await this.request('/' + encodeURIComponent(orderCode) + '/cancel', {
      method: 'POST',
      body: JSON.stringify({
        cancellationReason: 'Khách chuyển phương thức hoặc hủy thanh toán',
      }),
    });
  }

  async getPaymentLink(orderCode: string): Promise<PayosLinkResult> {
    const data = await this.request('/' + encodeURIComponent(orderCode));
    if (!data.id)
      throw new AppError(
        502,
        'PAYOS_INVALID_RESPONSE',
        'PayOS trả dữ liệu không hợp lệ',
      );
    return {
      paymentUrl: data.checkoutUrl ?? 'https://pay.payos.vn/web/' + data.id,
      paymentLinkId: data.id,
      qrCode: data.qrCode ?? '',
      orderCode,
    };
  }

  async getPaymentStatus(
    orderCode: string,
  ): Promise<{ status: string; amount: number; amountPaid: number }> {
    const data = await this.request('/' + encodeURIComponent(orderCode));
    if (
      !['PENDING', 'PROCESSING', 'PAID', 'CANCELLED', 'EXPIRED'].includes(
        data.status,
      ) ||
      !Number.isFinite(data.amount) ||
      !Number.isFinite(data.amountPaid) ||
      String(data.orderCode) !== orderCode
    )
      throw new AppError(
        502,
        'PAYOS_INVALID_RESPONSE',
        'PayOS trả dữ liệu trạng thái không hợp lệ',
      );
    return {
      status: data.status,
      amount: data.amount,
      amountPaid: data.amountPaid,
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
