import { Injectable } from '@nestjs/common';
import { createTransport } from 'nodemailer';

/**
 * SMTP Gmail cho OTP đăng ký/reset. Không đọc secret từ repo khác.
 */
@Injectable()
export class MailService {
  async sendEmail(to: string, subject: string, body: string): Promise<void> {
    const host = process.env.MAIL_HOST ?? 'smtp.gmail.com';
    const port = Number(process.env.MAIL_PORT ?? '587');
    const senderEmail = process.env.MAIL_SENDER_EMAIL?.trim() ?? '';
    const senderName = process.env.MAIL_SENDER_NAME?.trim() || 'Hệ thống PBMS';
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

    await transporter.sendMail({
      from: `"${senderName}" <${senderEmail}>`,
      to,
      subject,
      text: body,
    });
  }
}
