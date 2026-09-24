import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, UserRole } from '@prisma/client';
import { createHash, randomInt } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { HashingService } from '../services/hashing.service';
import { MailService } from '../services/mail.service';
import { OtpStoreService } from '../services/otp-store.service';
import { PbmsResponseDto } from '../../common/dto/pbms-response.dto';
import { pbmsPick } from '../../common/pbms-fields';
import { Role } from '../enums/role.enum';
import {
  PbmsLoginDto,
  PbmsRefreshTokenDto,
  PbmsRegisterDto,
  PbmsRequestOtpDto,
  PbmsVerifyRegisterOtpDto,
  PbmsVerifyResetPasswordOtpDto,
} from './dto/pbms-auth.dto';

const OTP_TTL_MS = 10 * 60 * 1000;
const ACCESS_TOKEN_EXPIRATION = '15m';
const REFRESH_TOKEN_EXPIRATION_DAYS = 7;
const PHONE_REGEX = /^(0|\+84)(3|5|7|8|9)[0-9]{8}$/;

interface CachedRegister {
  userName: string;
  fullName: string;
  email: string;
  phoneNumber: string;
  password: string;
  otpHash: string;
}

@Injectable()
export class PbmsAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly hashingService: HashingService,
    private readonly mailService: MailService,
    private readonly otpStore: OtpStoreService,
  ) {}

  async login(dto: PbmsLoginDto): Promise<PbmsResponseDto> {
    const email = this.normalizeEmail(pbmsPick(dto, 'email', 'Email'));
    const password = pbmsPick(dto, 'password', 'Password');

    const user = await this.findUserByEmail(email);
    if (!user) {
      return new PbmsResponseDto('Không tìm thấy người dùng', 400, false);
    }

    const isPasswordValid = await this.hashingService.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      return new PbmsResponseDto('Sai mật khẩu', 400, false);
    }

    if (!this.isPbmsActive(user.status, user.isActive)) {
      if (this.isPbmsBanned(user.status)) {
        return new PbmsResponseDto('Tài khoản của bạn đã bị khóa', 403, false);
      }
      return new PbmsResponseDto(
        'Tài khoản chưa được kích hoạt hoặc đã bị vô hiệu hóa',
        403,
        false,
      );
    }

    try {
      const tokens = await this.issuePbmsTokenPair(user);
      return new PbmsResponseDto('Đăng nhập thành công', 200, true, {
        user: {
          userId: user.id,
          userName: user.userName,
          email: user.email,
          fullName: user.fullName,
          phoneNumber: user.phoneNumber,
          roleName: user.pbmsRole?.roleName ?? 'customer',
        },
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      });
    } catch {
      return new PbmsResponseDto('Lỗi lưu refresh token vào cơ sở dữ liệu', 500, false);
    }
  }

  async sendRegisterOtp(dto: PbmsRegisterDto): Promise<PbmsResponseDto> {
    let userName = pbmsPick(dto, 'userName', 'UserName').trim();
    if (!userName) {
      return new PbmsResponseDto('Vui lòng nhập UserName', 400, false);
    }
    if (userName.length > 50) {
      return new PbmsResponseDto('UserName không được vượt quá 50 ký tự', 400, false);
    }
    if (await this.prisma.user.findUnique({ where: { userName } })) {
      return new PbmsResponseDto('UserName đã tồn tại', 409, false);
    }

    const rawEmail = pbmsPick(dto, 'email', 'Email');
    if (!rawEmail.trim()) {
      return new PbmsResponseDto('Vui lòng nhập Email', 400, false);
    }
    if (!this.isValidEmail(rawEmail)) {
      return new PbmsResponseDto('Email sai định dạng', 400, false);
    }
    const email = this.normalizeEmail(rawEmail);
    if (email.length > 100) {
      return new PbmsResponseDto('Email không được vượt quá 100 ký tự', 400, false);
    }
    if (await this.findUserByEmail(email)) {
      return new PbmsResponseDto('Email đã được đăng ký.', 400, false);
    }

    const password = pbmsPick(dto, 'password', 'Password');
    const confirmPassword = pbmsPick(dto, 'confirmPassword', 'ConfirmPassword');
    if (!password) {
      return new PbmsResponseDto('Vui lòng nhập mật khẩu', 400, false);
    }
    if (password !== confirmPassword) {
      return new PbmsResponseDto('Mật khẩu không khớp', 400, false);
    }

    let fullName = pbmsPick(dto, 'fullName', 'FullName').trim();
    if (!fullName) {
      return new PbmsResponseDto('Vui lòng nhập tên đầy đủ', 400, false);
    }
    if (fullName.length > 100) {
      return new PbmsResponseDto('Tên đầy đủ không được vượt quá 100 ký tự', 400, false);
    }

    let phoneNumber = pbmsPick(dto, 'phoneNumber', 'PhoneNumber').trim();
    if (!phoneNumber) {
      return new PbmsResponseDto('Vui lòng nhập số điện thoại', 400, false);
    }
    if (!PHONE_REGEX.test(phoneNumber)) {
      return new PbmsResponseDto('Số điện thoại không hợp lệ', 400, false);
    }
    if (await this.prisma.user.findUnique({ where: { phoneNumber } })) {
      return new PbmsResponseDto('Số điện thoại đã được đăng ký', 409, false);
    }

    const otp = randomInt(100000, 1000000).toString();
    const otpHash = this.hashSha256(otp);
    this.otpStore.set<CachedRegister>(
      `Register_${email}`,
      { userName, fullName, email, phoneNumber, password, otpHash },
      OTP_TTL_MS,
    );

    try {
      await this.mailService.sendOtpEmail(email, otp, 'registration');
      return new PbmsResponseDto('Nếu email tồn tại, OTP đã được gửi', 200, true);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'unknown';
      return new PbmsResponseDto(`Đã xảy ra lỗi khi gửi OTP đăng ký: ${message}`, 500, false);
    }
  }

  async verifyRegisterOtp(dto: PbmsVerifyRegisterOtpDto): Promise<PbmsResponseDto> {
    const emailRaw = pbmsPick(dto, 'email', 'Email');
    const otp = pbmsPick(dto, 'otp', 'Otp');
    if (!emailRaw.trim() || !otp.trim()) {
      return new PbmsResponseDto('Vui lòng nhập đầy đủ thông tin', 400, false);
    }

    const email = this.normalizeEmail(emailRaw);
    const cached = this.otpStore.get<CachedRegister>(`Register_${email}`);
    if (!cached) {
      return new PbmsResponseDto('Mã OTP không hợp lệ hoặc đã hết hạn', 400, false);
    }
    if (this.hashSha256(otp) !== cached.otpHash) {
      return new PbmsResponseDto('Mã OTP không đúng', 400, false);
    }

    if (await this.findUserByEmail(cached.email)) {
      return new PbmsResponseDto('Email đã được đăng ký bởi người khác.', 400, false);
    }
    if (await this.prisma.user.findUnique({ where: { userName: cached.userName } })) {
      return new PbmsResponseDto('UserName đã được đăng ký bởi người khác.', 409, false);
    }
    if (await this.prisma.user.findUnique({ where: { phoneNumber: cached.phoneNumber } })) {
      return new PbmsResponseDto('Số điện thoại đã được đăng ký bởi người khác.', 409, false);
    }

    const defaultRole = await this.prisma.role.findFirst({
      where: { OR: [{ id: 1 }, { roleName: { equals: 'customer', mode: 'insensitive' } }] },
    });
    if (!defaultRole) {
      return new PbmsResponseDto(
        "Lỗi cấu hình hệ thống: Không tìm thấy quyền 'customer' mặc định",
        500,
        false,
      );
    }

    const passwordHash = await this.hashingService.hash(cached.password);
    try {
      const newUser = await this.prisma.user.create({
        data: {
          email: cached.email,
          passwordHash,
          userName: cached.userName,
          fullName: cached.fullName,
          phoneNumber: cached.phoneNumber,
          status: 'Active',
          isActive: true,
          isEmailVerified: true,
          role: UserRole.USER,
          roleId: defaultRole.id,
        },
      });
      this.otpStore.delete(`Register_${email}`);
      return new PbmsResponseDto('Đăng ký thành công', 200, true, { userId: newUser.id });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return new PbmsResponseDto(
          'Email, UserName hoặc số điện thoại vừa được tài khoản khác sử dụng. Vui lòng kiểm tra lại.',
          409,
          false,
        );
      }
      return new PbmsResponseDto(
        'Không thể tạo tài khoản do lỗi hệ thống. Vui lòng thử lại sau.',
        500,
        false,
      );
    }
  }

  async requestResetPasswordOtp(dto: PbmsRequestOtpDto): Promise<PbmsResponseDto> {
    const rawEmail = pbmsPick(dto, 'email', 'Email');
    if (!rawEmail.trim()) {
      return new PbmsResponseDto('Vui lòng nhập Email', 400, false);
    }

    const email = this.normalizeEmail(rawEmail);
    const user = await this.findUserByEmail(email);
    if (!user) {
      return new PbmsResponseDto('Nếu email tồn tại, OTP đã được gửi', 200, true);
    }

    const otp = randomInt(100000, 1000000).toString();
    this.otpStore.set(`Reset_${email}`, this.hashSha256(otp), OTP_TTL_MS);

    try {
      await this.mailService.sendOtpEmail(email, otp, 'password-reset');
      return new PbmsResponseDto('Nếu email tồn tại, OTP đã được gửi', 200, true);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'unknown';
      return new PbmsResponseDto(
        `Đã xảy ra lỗi khi gửi OTP reset mật khẩu: ${message}`,
        500,
        false,
      );
    }
  }

  async verifyResetPasswordOtp(dto: PbmsVerifyResetPasswordOtpDto): Promise<PbmsResponseDto> {
    const emailRaw = pbmsPick(dto, 'email', 'Email');
    const otp = pbmsPick(dto, 'otp', 'Otp');
    const newPassword = pbmsPick(dto, 'newPassword', 'NewPassword');
    const confirmPassword = pbmsPick(dto, 'confirmPassword', 'ConfirmPassword');

    if (!emailRaw.trim() || !otp.trim() || !newPassword) {
      return new PbmsResponseDto('Vui lòng nhập đầy đủ thông tin', 400, false);
    }
    if (newPassword !== confirmPassword) {
      return new PbmsResponseDto('Mật khẩu xác nhận không khớp', 400, false);
    }

    const email = this.normalizeEmail(emailRaw);
    const cachedOtpHash = this.otpStore.get<string>(`Reset_${email}`);
    if (!cachedOtpHash) {
      return new PbmsResponseDto('Mã OTP không hợp lệ hoặc đã hết hạn', 400, false);
    }
    if (this.hashSha256(otp) !== cachedOtpHash) {
      return new PbmsResponseDto('Mã OTP không đúng', 400, false);
    }

    const user = await this.findUserByEmail(email);
    if (!user) {
      return new PbmsResponseDto('Người dùng không tồn tại trên hệ thống', 404, false);
    }

    try {
      const passwordHash = await this.hashingService.hash(newPassword);
      await this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash },
      });
      this.otpStore.delete(`Reset_${email}`);
      return new PbmsResponseDto('Đặt lại mật khẩu thành công', 200, true);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'unknown';
      return new PbmsResponseDto(
        `Lỗi hệ thống khi cập nhật mật khẩu mới: ${message}`,
        500,
        false,
      );
    }
  }

  async refreshToken(dto: PbmsRefreshTokenDto): Promise<PbmsResponseDto> {
    const rawToken = pbmsPick(dto, 'refreshTokenKey', 'RefreshTokenKey').trim();
    if (!rawToken) {
      return new PbmsResponseDto('Vui lòng nhập refresh token', 400, false);
    }

    let userId: string;
    try {
      const payload = await this.jwtService.verifyAsync<{ sub?: string }>(rawToken, {
        secret: this.refreshSecret(),
      });
      if (!payload.sub) {
        return new PbmsResponseDto('Token không chứa thông tin định danh hợp lệ', 401, false);
      }
      userId = payload.sub;
    } catch {
      return new PbmsResponseDto('Refresh token không hợp lệ hoặc hết hạn', 401, false);
    }

    const sessions = await this.prisma.refreshToken.findMany({
      where: { userId, isRevoked: false, expiresAt: { gt: new Date() } },
    });
    let matched = false;
    for (const session of sessions) {
      if (await this.hashingService.compare(rawToken, session.tokenHash)) {
        matched = true;
        break;
      }
    }
    if (!matched) {
      return new PbmsResponseDto(
        'Refresh token không tồn tại hoặc đã bị vô hiệu hóa',
        401,
        false,
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { pbmsRole: true },
    });
    if (!user) {
      return new PbmsResponseDto('Người dùng không tồn tại trên hệ thống', 404, false);
    }
    if (!this.isPbmsActive(user.status, user.isActive)) {
      return new PbmsResponseDto(
        'Tài khoản đã bị khóa hoặc vô hiệu hóa. Không thể làm mới token',
        403,
        false,
      );
    }

    const accessToken = await this.signAccessToken(user);
    return new PbmsResponseDto('Cấp token mới thành công', 200, true, { accessToken });
  }

  async logout(dto: PbmsRefreshTokenDto): Promise<PbmsResponseDto> {
    const rawToken = pbmsPick(dto, 'refreshTokenKey', 'RefreshTokenKey').trim();
    if (!rawToken) {
      return new PbmsResponseDto('Vui lòng nhập refresh token', 400, false);
    }

    let userId: string | undefined;
    try {
      const payload = await this.jwtService.verifyAsync<{ sub?: string }>(rawToken, {
        secret: this.refreshSecret(),
        ignoreExpiration: true,
      });
      userId = payload.sub;
    } catch {
      userId = undefined;
    }

    const sessions = await this.prisma.refreshToken.findMany({
      where: {
        isRevoked: false,
        ...(userId ? { userId } : {}),
      },
    });

    for (const session of sessions) {
      if (await this.hashingService.compare(rawToken, session.tokenHash)) {
        await this.prisma.refreshToken.update({
          where: { id: session.id },
          data: { isRevoked: true },
        });
        break;
      }
    }

    return new PbmsResponseDto('Đăng xuất thành công', 200, true);
  }

  private async issuePbmsTokenPair(user: {
    id: string;
    email: string;
    userName: string | null;
    role: UserRole;
    roleId: number;
    pbmsRole: { roleName: string } | null;
  }): Promise<{ accessToken: string; refreshToken: string }> {
    const accessToken = await this.signAccessToken(user);
    const refreshToken = await this.jwtService.signAsync(
      { sub: user.id, email: user.email, TokenPurpose: 'RefreshToken' },
      {
        secret: this.refreshSecret(),
        expiresIn: `${REFRESH_TOKEN_EXPIRATION_DAYS}d`,
      },
    );

    const tokenHash = await this.hashingService.hash(refreshToken);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRATION_DAYS);
    await this.prisma.refreshToken.create({
      data: { userId: user.id, tokenHash, expiresAt },
    });

    return { accessToken, refreshToken };
  }

  private async signAccessToken(user: {
    id: string;
    email: string;
    userName: string | null;
    role: UserRole;
    roleId: number;
    pbmsRole: { roleName: string } | null;
  }): Promise<string> {
    const pbmsRoleName = user.pbmsRole?.roleName ?? 'customer';
    return this.jwtService.signAsync(
      {
        sub: user.id,
        email: user.email,
        role: pbmsRoleName,
        nestRole: user.role as Role,
        UserId: user.id,
        UserName: user.userName ?? '',
        Email: user.email,
        RoleId: user.roleId,
      },
      {
        secret: this.accessSecret(),
        expiresIn: ACCESS_TOKEN_EXPIRATION,
      },
    );
  }

  private async findUserByEmail(email: string) {
    if (!email) {
      return null;
    }
    return this.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      include: { pbmsRole: true },
    });
  }

  private isPbmsActive(status: string | null, isActive: boolean): boolean {
    return isActive && (status ?? 'Active').toLowerCase() === 'active';
  }

  private isPbmsBanned(status: string | null): boolean {
    return (status ?? '').toLowerCase() === 'banned';
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  }

  private hashSha256(input: string): string {
    return createHash('sha256').update(input, 'utf8').digest('hex');
  }

  private accessSecret(): string {
    return process.env.JWT_ACCESS_SECRET || 'prm393_enterprise_access_secret_key_2026';
  }

  private refreshSecret(): string {
    return process.env.JWT_REFRESH_SECRET || 'prm393_enterprise_refresh_secret_key_2026';
  }
}
