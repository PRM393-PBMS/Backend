import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { classifyError, AppError } from './errors';
import { PbmsResponseDto } from './dto/pbms-response.dto';
import { INVALID_CREDENTIALS_MESSAGE, userErrorMessage } from './user-message';

describe('End-user error copy', () => {
  it.each([
    'Invalid credential',
    'Invalid credentials',
    'Tài khoản hoặc mật khẩu không chính xác.',
  ])('gives the same login guidance for %s', (message) => {
    expect(classifyError(new UnauthorizedException(message)).message).toBe(
      INVALID_CREDENTIALS_MESSAGE,
    );
  });
  it.each([
    'PrismaClientKnownRequestError: lỗi truy vấn SELECT secret FROM users',
    'Có lỗi: Error at node_modules/private-file.ts:10',
    '<html>Máy chủ lỗi</html>',
    'ECONNREFUSED 127.0.0.1:5432',
    'Internal server error',
  ])('does not show diagnostics: %s', (message) => {
    expect(PbmsResponseDto.fail(message, 500).message).toBe(
      'Đã có sự cố xảy ra. Vui lòng thử lại sau.',
    );
  });
  it('keeps business guidance and payment recovery metadata', () => {
    const result = PbmsResponseDto.fromError(
      new AppError(
        402,
        'INSUFFICIENT_FUNDS',
        'Ví không đủ tiền. Vui lòng nạp thêm 12.000đ.',
        { balance: 5000, remainingAmount: 12000 },
      ),
    );
    expect(result.message).toContain('12.000đ');
    expect(result).toMatchObject({
      statusCode: 402,
      isSuccess: false,
      errorCode: 'INSUFFICIENT_FUNDS',
      details: { balance: 5000, remainingAmount: 12000 },
    });
  });
  it('keeps unknown payment outcome distinct from definite failure', () => {
    const result = classifyError(
      new AppError(503, 'PAYMENT_STATUS_UNKNOWN', 'PayOS unavailable'),
    );
    expect(result.message).toContain('trước khi thanh toán lại');
    expect(result.code).toBe('PAYMENT_STATUS_UNKNOWN');
  });
  it('uses field labels without exposing identifiers', () => {
    expect(userErrorMessage('VehicleId không hợp lệ', 400)).toBe(
      'Xe không hợp lệ',
    );
    expect(userErrorMessage('UserName đã tồn tại', 409)).toBe(
      'Tên đăng nhập đã tồn tại',
    );
  });
  it('does not mistake OTP expiry for a login session error', () => {
    expect(
      classifyError(
        new AppError(
          400,
          'OTP_EXPIRED',
          'Mã xác thực đã hết hạn. Vui lòng yêu cầu mã mới.',
        ),
      ).message,
    ).toContain('yêu cầu mã mới');
  });
  it('keeps validation details machine-readable and primary copy readable', () => {
    const result = classifyError(
      new BadRequestException(['email must be an email']),
    );
    expect(result.message).toContain('Vui lòng kiểm tra');
    expect(result.details).toEqual(['email must be an email']);
  });
  it('preserves specific recovery for an email timeout through the envelope', () => {
    const result = PbmsResponseDto.fromError(
      new AppError(504, 'MAIL_TIMEOUT', 'timeout'),
    );
    expect(result.message).toContain('hộp thư và thư rác');
  });
});
