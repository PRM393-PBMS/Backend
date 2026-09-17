import { buildSmtpTransportOptions, resolveMailSecure } from './mail.service';

describe('resolveMailSecure', () => {
  it('port 465 mặc định SSL, port 587 mặc định STARTTLS', () => {
    expect(resolveMailSecure(465, undefined)).toBe(true);
    expect(resolveMailSecure(587, undefined)).toBe(false);
    expect(resolveMailSecure(587, '')).toBe(false);
  });

  it('MAIL_SECURE ghi đè suy luận theo port', () => {
    expect(resolveMailSecure(587, 'true')).toBe(true);
    expect(resolveMailSecure(465, 'false')).toBe(false);
    expect(resolveMailSecure(587, '0')).toBe(false);
  });
});

describe('buildSmtpTransportOptions', () => {
  it('587 bật requireTLS và timeout đủ dài cho Render', () => {
    const options = buildSmtpTransportOptions({
      MAIL_HOST: 'smtp.gmail.com',
      MAIL_PORT: '587',
      MAIL_SENDER_EMAIL: 'sender@example.com',
      MAIL_PASSWORD: 'app-password',
    });

    expect(options).toMatchObject({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      requireTLS: true,
      connectionTimeout: 30_000,
      greetingTimeout: 20_000,
      family: 4,
    });
  });

  it('465 dùng SSL, không yêu cầu STARTTLS', () => {
    const options = buildSmtpTransportOptions({
      MAIL_PORT: '465',
      MAIL_SENDER_EMAIL: 'sender@example.com',
      MAIL_PASSWORD: 'app-password',
    });

    expect(options).toMatchObject({
      port: 465,
      secure: true,
      requireTLS: false,
    });
  });
});
