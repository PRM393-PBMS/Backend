import { Injectable } from '@nestjs/common';
import { Resend } from 'resend';
import {
  createOtpEmailTemplate,
  type OtpEmailPurpose,
} from './otp-email-template';

/**
 * Gửi OTP đăng ký/reset qua Resend Emails API (HTTPS).
 * Local và Render cùng một kênh; không còn SMTP/Nodemailer.
 */
@Injectable()
export class MailService {
  async sendOtpEmail(
    to: string,
    otp: string,
    purpose: OtpEmailPurpose,
  ): Promise<void> {
    const apiKey = process.env.RESEND_API_KEY?.trim() ?? '';
    if (!apiKey) {
      throw new Error(
        'Chưa cấu hình Resend: cần RESEND_API_KEY trong môi trường.',
      );
    }

    const fromEmail = process.env.MAIL_FROM?.trim() ?? '';
    if (!fromEmail) {
      throw new Error('Chưa cấu hình Resend: cần MAIL_FROM trong môi trường.');
    }

    const senderName = process.env.MAIL_SENDER_NAME?.trim() || 'NEO Force Lab';
    const replyTo = process.env.MAIL_REPLY_TO?.trim() || fromEmail;

    const content = createOtpEmailTemplate({
      brandName: senderName,
      brandColor: this.brandColor(),
      otp,
      purpose,
    });

    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from: `"${senderName}" <${fromEmail}>`,
      to,
      replyTo,
      subject: content.subject,
      text: content.text,
      html: content.html,
    });

    if (error) {
      throw new Error(`Gửi email Resend thất bại: ${error.message}`);
    }
  }

  private brandColor(): string {
    const color = process.env.MAIL_BRAND_COLOR?.trim();
    return color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#0F766E';
  }
}
