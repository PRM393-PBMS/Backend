import { Injectable } from '@nestjs/common';
import { createTransport } from 'nodemailer';

type OtpEmailPurpose = 'registration' | 'password-reset';

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

    const content = this.otpContent(purpose);

    await transporter.sendMail({
      from: `"${senderName}" <${senderEmail}>`,
      to,
      subject: content.subject,
      text: `${content.heading}\n\nMã OTP của bạn là: ${otp}\nMã có hiệu lực trong 10 phút.\n\nNếu bạn không thực hiện yêu cầu này, hãy bỏ qua email.`,
      html: this.otpHtml(senderName, otp, content),
    });
  }

  private otpContent(purpose: OtpEmailPurpose): {
    readonly subject: string;
    readonly heading: string;
    readonly description: string;
  } {
    return purpose === 'registration'
      ? {
          subject: 'Xác nhận đăng ký tài khoản',
          heading: 'Xác nhận đăng ký',
          description: 'Dùng mã bên dưới để hoàn tất đăng ký tài khoản của bạn.',
        }
      : {
          subject: 'Xác nhận đặt lại mật khẩu',
          heading: 'Đặt lại mật khẩu',
          description: 'Dùng mã bên dưới để xác nhận yêu cầu đặt lại mật khẩu.',
        };
  }

  private otpHtml(
    senderName: string,
    otp: string,
    content: ReturnType<MailService['otpContent']>,
  ): string {
    const brandName = this.escapeHtml(senderName);
    const safeOtp = this.escapeHtml(otp);

    return `<!doctype html>
<html lang="vi">
  <body style="margin:0;background:#f4f7fb;font-family:Arial,sans-serif;color:#172033;">
    <main style="max-width:560px;margin:32px auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 24px rgba(15,23,42,.08);">
      <header style="padding:28px 32px;background:#0f766e;color:#ffffff;">
        <p style="margin:0;font-size:14px;opacity:.85;">${brandName}</p>
        <h1 style="margin:8px 0 0;font-size:24px;">${content.heading}</h1>
      </header>
      <section style="padding:32px;">
        <p style="margin:0 0 20px;font-size:16px;line-height:1.6;">${content.description}</p>
        <div style="margin:24px 0;padding:20px;border-radius:12px;background:#ecfdf5;text-align:center;">
          <p style="margin:0 0 8px;color:#475569;font-size:13px;">MÃ XÁC THỰC</p>
          <strong style="color:#0f766e;font-size:32px;letter-spacing:8px;">${safeOtp}</strong>
        </div>
        <p style="margin:0;font-size:14px;line-height:1.6;color:#475569;">Mã có hiệu lực trong <strong>10 phút</strong>. Không chia sẻ mã này với bất kỳ ai.</p>
      </section>
      <footer style="padding:20px 32px;background:#f8fafc;color:#64748b;font-size:12px;line-height:1.5;">
        Nếu bạn không thực hiện yêu cầu này, hãy bỏ qua email. Đây là email được gửi tự động.
      </footer>
    </main>
  </body>
</html>`;
  }

  private escapeHtml(value: string): string {
    return value.replace(/[&<>'"]/g, (character) => {
      const entities: Record<string, string> = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;',
      };
      return entities[character];
    });
  }
}
