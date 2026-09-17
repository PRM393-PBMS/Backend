import { Injectable } from '@nestjs/common';
import { createTransport } from 'nodemailer';
import {
  createOtpEmailTemplate,
  type OtpEmailPurpose,
} from './otp-email-template';

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
    const host = process.env.MAIL_HOST ?? 'smtp.gmail.com';
    const port = Number(process.env.MAIL_PORT ?? '587');
    const senderEmail = process.env.MAIL_SENDER_EMAIL?.trim() ?? '';
    const senderName = process.env.MAIL_SENDER_NAME?.trim() || 'Hệ thống PBMS';
    const replyTo = process.env.MAIL_REPLY_TO?.trim() || senderEmail;
    const password = process.env.MAIL_PASSWORD ?? '';

    if (!senderEmail || !password) {
      throw new Error(
        'Chưa cấu hình SMTP: cần MAIL_SENDER_EMAIL và MAIL_PASSWORD trong môi trường.',
      );
    }

    const transporter = createTransport({
      host,
      port,
      secure: port === 465,
      auth: {
        user: senderEmail,
        pass: password,
      },
    });

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
