import { createOtpEmailTemplate } from './otp-email-template';

describe('createOtpEmailTemplate', () => {
  it('tạo email OTP đăng ký với markup hỗ trợ email client và text fallback', () => {
    const email = createOtpEmailTemplate({
      brandName: 'NEOForce Parking Management',
      brandColor: '#0F766E',
      otp: '123456',
      purpose: 'registration',
    });

    expect(email.subject).toBe(
      'Xác nhận đăng ký tài khoản | NEOForce Parking Management',
    );
    expect(email.text).toContain('Mã xác thực: 123456');
    expect(email.html).toContain('<html lang="vi" dir="ltr">');
    expect(email.html).toContain('<div lang="vi" dir="ltr">');
    expect(email.html).toContain(
      '<title>Xác nhận đăng ký tài khoản | NEOForce Parking Management</title>',
    );
    expect(email.html).toContain('role="presentation"');
    expect(email.html).toContain('Mã có hiệu lực trong 10 phút.');
  });

  it('escape giá trị động trước khi đưa vào HTML', () => {
    const email = createOtpEmailTemplate({
      brandName: '<PBMS>',
      brandColor: '#0F766E',
      otp: '12<345',
      purpose: 'password-reset',
    });

    expect(email.html).toContain('&lt;PBMS&gt;');
    expect(email.html).toContain('12&lt;345');
    expect(email.html).not.toContain('<PBMS>');
  });
});
