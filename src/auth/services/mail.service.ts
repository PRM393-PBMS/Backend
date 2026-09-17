import { Injectable } from '@nestjs/common';
import { createTransport } from 'nodemailer';
import {
  createOtpEmailTemplate,
  type OtpEmailPurpose,
} from './otp-email-template';

/** Render → Gmail 587: chờ handshake STARTTLS thay vì cắt quá sớm. */
const SMTP_CONNECTION_TIMEOUT_MS = 30_000;
const SMTP_GREETING_TIMEOUT_MS = 20_000;
const SMTP_SOCKET_TIMEOUT_MS = 30_000;

export type SmtpTransportOptions = {
  host: string;
  port: number;
  secure: boolean;
  requireTLS: boolean;
  family: 4;
  connectionTimeout: number;
  greetingTimeout: number;
  socketTimeout: number;
  auth: { user: string; pass: string };
};

/**
 * 465 = implicit SSL. 587 = STARTTLS (`secure: false`).
 * MAIL_SECURE=true|false ghi đè khi cần.
 */
export function resolveMailSecure(
  port: number,
  mailSecureEnv: string | undefined,
): boolean {
  const explicit = mailSecureEnv?.trim().toLowerCase();
  if (explicit === 'true' || explicit === '1') {
    return true;
  }
  if (explicit === 'false' || explicit === '0') {
    return false;
  }
  return port === 465;
}

export function buildSmtpTransportOptions(
  env: NodeJS.ProcessEnv,
): SmtpTransportOptions {
  const host = env.MAIL_HOST ?? 'smtp.gmail.com';
  const port = Number(env.MAIL_PORT ?? '587');
  const secure = resolveMailSecure(port, env.MAIL_SECURE);

  return {
    host,
    port,
    secure,
    requireTLS: !secure && port === 587,
    // Render thường resolve IPv6 trước; smtp.gmail.com IPv6 hay treo đến Connection timeout.
    family: 4,
    connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS,
    greetingTimeout: SMTP_GREETING_TIMEOUT_MS,
    socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
    auth: {
      user: env.MAIL_SENDER_EMAIL?.trim() ?? '',
      pass: env.MAIL_PASSWORD ?? '',
    },
  };
}

/**
 * SMTP Gmail cho OTP đăng ký/reset. Không đọc secret từ repo khác.
 */
@Injectable()
export class MailService {
  async sendOtpEmail(
    to: string,
    otp: string,
    purpose: OtpEmailPurpose,
  ): Promise<void> {
    const senderEmail = process.env.MAIL_SENDER_EMAIL?.trim() ?? '';
    const senderName = process.env.MAIL_SENDER_NAME?.trim() || 'Hệ thống PBMS';
    const replyTo = process.env.MAIL_REPLY_TO?.trim() || senderEmail;
    const password = process.env.MAIL_PASSWORD ?? '';

    if (!senderEmail || !password) {
      throw new Error(
        'Chưa cấu hình SMTP: cần MAIL_SENDER_EMAIL và MAIL_PASSWORD trong môi trường.',
      );
    }

    const transporter = createTransport(buildSmtpTransportOptions(process.env));

    const content = createOtpEmailTemplate({
      brandName: senderName,
      brandColor: this.brandColor(),
      otp,
      purpose,
    });

    await transporter.sendMail({
      from: `"${senderName}" <${senderEmail}>`,
      replyTo,
      to,
      subject: content.subject,
      text: content.text,
      html: content.html,
    });
  }

  private brandColor(): string {
    const color = process.env.MAIL_BRAND_COLOR?.trim();
    return color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#0F766E';
  }
}
