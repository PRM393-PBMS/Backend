import { AppError } from '../../common/errors';
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
      throw new AppError(
        503,
        'MAIL_NOT_CONFIGURED',
        'Dịch vụ email chưa được cấu hình',
      );
    }

    const fromEmail = process.env.MAIL_FROM?.trim() ?? '';
    if (!fromEmail) {
      throw new AppError(
        503,
        'MAIL_NOT_CONFIGURED',
        'Dịch vụ email chưa được cấu hình',
      );
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
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const { error } = await Promise.race([
      resend.emails.send({
        from: `"${senderName}" <${fromEmail}>`,
        to,
        replyTo,
        subject: content.subject,
        text: content.text,
        html: content.html,
      }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              new AppError(
                504,
                'MAIL_TIMEOUT',
                'Dịch vụ email phản hồi quá chậm',
              ),
            ),
          10000,
        );
        timeout.unref();
      }),
    ]).finally(() => {
      if (timeout) clearTimeout(timeout);
    });

    if (error) {
      throw new AppError(
        502,
        'MAIL_SEND_FAILED',
        'Chưa gửi được email OTP; vui lòng thử lại sau',
      );
    }
  }

  private brandColor(): string {
    const color = process.env.MAIL_BRAND_COLOR?.trim();
    return color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#0F766E';
  }
}
