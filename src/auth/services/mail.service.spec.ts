import { Resend } from 'resend';
import { MailService } from './mail.service';

jest.mock('resend');

const sendMock = jest.fn();
const ResendMock = Resend as unknown as jest.Mock;

describe('MailService', () => {
  const originalEnv = process.env;
  let service: MailService;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.RESEND_API_KEY;
    delete process.env.MAIL_FROM;
    delete process.env.MAIL_SENDER_NAME;
    delete process.env.MAIL_REPLY_TO;
    delete process.env.MAIL_BRAND_COLOR;

    sendMock.mockReset();
    sendMock.mockResolvedValue({ data: { id: 'email_1' }, error: null });
    ResendMock.mockReset();
    ResendMock.mockImplementation(() => ({
      emails: { send: sendMock },
    }));

    service = new MailService();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('ném lỗi rõ khi thiếu RESEND_API_KEY, không gọi Resend', async () => {
    process.env.MAIL_FROM = 'otp@neoforcelab.com';

    await expect(
      service.sendOtpEmail('user@example.com', '123456', 'registration'),
    ).rejects.toThrow('Chưa cấu hình Resend: cần RESEND_API_KEY trong môi trường.');

    expect(ResendMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('ném lỗi khi thiếu MAIL_FROM', async () => {
    process.env.RESEND_API_KEY = 're_test_placeholder';

    await expect(
      service.sendOtpEmail('user@example.com', '123456', 'registration'),
    ).rejects.toThrow('Chưa cấu hình Resend: cần MAIL_FROM trong môi trường.');

    expect(ResendMock).not.toHaveBeenCalled();
  });

  it('gửi HTML OTP qua Resend emails API', async () => {
    process.env.RESEND_API_KEY = 're_test_placeholder';
    process.env.MAIL_FROM = 'otp@neoforcelab.com';
    process.env.MAIL_SENDER_NAME = 'NEO Force Lab';
    process.env.MAIL_REPLY_TO = 'otp@neoforcelab.com';

    await service.sendOtpEmail('user@example.com', '123456', 'registration');

    expect(ResendMock).toHaveBeenCalledWith('re_test_placeholder');
    expect(sendMock).toHaveBeenCalledTimes(1);

    const payload = sendMock.mock.calls[0][0] as {
      from: string;
      to: string;
      replyTo: string;
      subject: string;
      html: string;
      text: string;
    };

    expect(payload.from).toBe('"NEO Force Lab" <otp@neoforcelab.com>');
    expect(payload.to).toBe('user@example.com');
    expect(payload.replyTo).toBe('otp@neoforcelab.com');
    expect(payload.subject).toContain('Xác nhận đăng ký tài khoản');
    expect(payload.html).toContain('123456');
    expect(payload.text).toContain('Mã xác thực: 123456');
  });

  it('Reply-To mặc định bằng MAIL_FROM khi MAIL_REPLY_TO trống', async () => {
    process.env.RESEND_API_KEY = 're_test_placeholder';
    process.env.MAIL_FROM = 'otp@neoforcelab.com';

    await service.sendOtpEmail('user@example.com', '654321', 'password-reset');

    const payload = sendMock.mock.calls[0][0] as { replyTo: string };
    expect(payload.replyTo).toBe('otp@neoforcelab.com');
  });

  it('ném lỗi khi Resend API trả error', async () => {
    process.env.RESEND_API_KEY = 're_test_placeholder';
    process.env.MAIL_FROM = 'otp@neoforcelab.com';
    sendMock.mockResolvedValue({
      data: null,
      error: { message: 'Invalid from address' },
    });

    await expect(
      service.sendOtpEmail('user@example.com', '123456', 'registration'),
    ).rejects.toThrow('Gửi email Resend thất bại: Invalid from address');
  });
});
