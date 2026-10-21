import { Injectable } from '@nestjs/common';
import { createHash, randomInt } from 'crypto';
import { HashingService } from '../auth/services/hashing.service';
import { MailService } from '../auth/services/mail.service';
import { OtpStoreService } from '../auth/services/otp-store.service';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import { isEmptyGuid, pbmsPick } from '../common/pbms-fields';
import { PrismaService } from '../prisma/prisma.service';

const OTP_TTL_MS = 10 * 60 * 1000;
/** Nhập sai quá số lần này thì mã bị huỷ, phải yêu cầu mã mới. */
const MAX_ATTEMPTS = 5;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface PendingEmailChange {
  newEmail: string;
  otpHash: string;
  attempts: number;
}

const key = (userId: string) => `EmailChange_${userId}`;
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/**
 * Đổi email hai bước: xác minh mật khẩu rồi gửi OTP tới email mới;
 * chỉ cập nhật email khi khách nhập đúng OTP (chứng minh sở hữu hộp thư mới).
 */
@Injectable()
export class EmailChangeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hashing: HashingService,
    private readonly mail: MailService,
    private readonly otpStore: OtpStoreService,
  ) {}

  async request(userId: string, dto: object): Promise<PbmsResponseDto> {
    if (isEmptyGuid(userId)) {
      return PbmsResponseDto.fail('Vui lòng đăng nhập', 401);
    }
    const newEmail = pbmsPick(dto, 'newEmail', 'NewEmail').trim().toLowerCase();
    const password = pbmsPick(dto, 'password', 'Password');
    if (!newEmail || !password) {
      return PbmsResponseDto.fail('Vui lòng nhập email mới và mật khẩu');
    }
    if (newEmail.length > 100 || !EMAIL_RE.test(newEmail)) {
      return PbmsResponseDto.fail('Email sai định dạng');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, passwordHash: true },
    });
    if (!user) {
      return PbmsResponseDto.fail('Không tìm thấy người dùng', 404);
    }
    if (!(await this.hashing.compare(password, user.passwordHash))) {
      return PbmsResponseDto.fail('Mật khẩu không đúng');
    }
    if (user.email.toLowerCase() === newEmail) {
      return PbmsResponseDto.fail('Email mới phải khác email hiện tại');
    }
    if (await this.emailTaken(newEmail, userId)) {
      return PbmsResponseDto.fail('Email đã được sử dụng');
    }
    const otp = randomInt(100000, 1000000).toString();
    await this.otpStore.set<PendingEmailChange>(
      key(userId),
      { newEmail, otpHash: sha256(otp), attempts: 0 },
      OTP_TTL_MS,
    );
    try {
      await this.mail.sendOtpEmail(newEmail, otp, 'email-change');
    } catch (error: unknown) {
      await this.otpStore.delete(key(userId));
      const message = error instanceof Error ? error.message : 'unknown';
      return PbmsResponseDto.fail(`Không gửi được mã xác nhận: ${message}`, 500);
    }
    return PbmsResponseDto.ok('Đã gửi mã xác nhận tới email mới', { newEmail });
  }

  async verify(userId: string, dto: object): Promise<PbmsResponseDto> {
    if (isEmptyGuid(userId)) {
      return PbmsResponseDto.fail('Vui lòng đăng nhập', 401);
    }
    const otp = pbmsPick(dto, 'otp', 'Otp').trim();
    if (!otp) {
      return PbmsResponseDto.fail('Vui lòng nhập mã xác nhận');
    }
    const pending = await this.otpStore.get<PendingEmailChange>(key(userId));
    if (!pending) {
      return PbmsResponseDto.fail('Mã xác nhận không hợp lệ hoặc đã hết hạn');
    }
    if (sha256(otp) !== pending.otpHash) {
      const attempts = pending.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) {
        await this.otpStore.delete(key(userId));
        return PbmsResponseDto.fail('Nhập sai quá nhiều lần, vui lòng yêu cầu mã mới');
      }
      await this.otpStore.set<PendingEmailChange>(key(userId), { ...pending, attempts }, OTP_TTL_MS);
      return PbmsResponseDto.fail('Mã xác nhận không đúng');
    }
    // Email có thể đã bị tài khoản khác lấy trong lúc chờ OTP.
    if (await this.emailTaken(pending.newEmail, userId)) {
      await this.otpStore.delete(key(userId));
      return PbmsResponseDto.fail('Email đã được sử dụng');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { email: pending.newEmail, isEmailVerified: true },
    });
    await this.otpStore.delete(key(userId));
    return PbmsResponseDto.ok('Đổi email thành công', { email: pending.newEmail });
  }

  private async emailTaken(email: string, userId: string): Promise<boolean> {
    const other = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' }, NOT: { id: userId } },
      select: { id: true },
    });
    return Boolean(other);
  }
}
