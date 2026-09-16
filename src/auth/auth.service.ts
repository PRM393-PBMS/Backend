import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { HashingService } from './services/hashing.service';
import {
  AuthResponseDto,
  ChangePasswordDto,
  LoginDto,
  MessageResponseDto,
  RegisterDto,
  UserProfileDto,
} from './dto';
import { Role } from './enums/role.enum';
import { JwtPayload, Tokens } from './types';

@Injectable()
export class AuthService {
  // Cấu hình thời hạn token chuẩn Enterprise
  private readonly ACCESS_TOKEN_EXPIRATION = '15m';
  private readonly REFRESH_TOKEN_EXPIRATION_DAYS = 7;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly hashingService: HashingService,
  ) {}

  /**
   * Đăng ký tài khoản người dùng mới
   */
  async register(
    dto: RegisterDto,
    deviceInfo?: string,
    ipAddress?: string,
  ): Promise<AuthResponseDto> {
    // 1. Kiểm tra email đã tồn tại hay chưa
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existingUser) {
      throw new ConflictException('Địa chỉ email này đã được sử dụng trong hệ thống.');
    }

    // 2. Băm mật khẩu an toàn với bcrypt (12 rounds)
    const passwordHash = await this.hashingService.hash(dto.password);

    // 3. Tạo tài khoản User mới trong cơ sở dữ liệu PostgreSQL
    const newUser = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        role: Role.USER,
      },
    });

    // 4. Sinh cặp Tokens và lưu Hashed Refresh Token vào CSDL
    const tokens = await this.generateTokens(newUser.id, newUser.email, newUser.role as Role);
    await this.saveRefreshToken(newUser.id, tokens.refreshToken, deviceInfo, ipAddress);

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: {
        id: newUser.id,
        email: newUser.email,
        role: newUser.role as Role,
        firstName: newUser.firstName,
        lastName: newUser.lastName,
      },
    };
  }

  /**
   * Đăng nhập người dùng bằng email và mật khẩu
   */
  async login(
    dto: LoginDto,
    deviceInfo?: string,
    ipAddress?: string,
  ): Promise<AuthResponseDto> {
    // 1. Tìm người dùng theo email
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user) {
      throw new UnauthorizedException('Tài khoản hoặc mật khẩu không chính xác.');
    }

    // 2. Kiểm tra trạng thái tài khoản
    if (!user.isActive) {
      throw new ForbiddenException('Tài khoản đã bị tạm khóa hoặc vô hiệu hóa.');
    }

    // 3. So khớp mật khẩu với chuỗi hash trong CSDL
    const isPasswordValid = await this.hashingService.compare(dto.password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Tài khoản hoặc mật khẩu không chính xác.');
    }

    // 4. Sinh cặp Tokens mới và lưu session vào DB
    const tokens = await this.generateTokens(user.id, user.email, user.role as Role);
    await this.saveRefreshToken(user.id, tokens.refreshToken, deviceInfo, ipAddress);

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role as Role,
        firstName: user.firstName,
        lastName: user.lastName,
      },
    };
  }

  /**
   * Cấp mới Tokens bằng Refresh Token (Token Rotation)
   */
  async refreshTokens(
    userId: string,
    rawRefreshToken: string,
    deviceInfo?: string,
    ipAddress?: string,
  ): Promise<AuthResponseDto> {
    // 1. Kiểm tra tài khoản người dùng
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || !user.isActive) {
      throw new ForbiddenException('Quyền truy cập bị từ chối.');
    }

    // 2. Lấy danh sách các session còn hạn chưa bị revoke của user
    const activeSessions = await this.prisma.refreshToken.findMany({
      where: {
        userId,
        isRevoked: false,
        expiresAt: { gt: new Date() },
      },
    });

    if (activeSessions.length === 0) {
      throw new ForbiddenException('Phiên đăng nhập đã hết hạn hoặc bị thu hồi.');
    }

    // 3. So khớp raw token với chuỗi hash trong các session active
    let matchedSession = null;
    for (const session of activeSessions) {
      const isMatch = await this.hashingService.compare(rawRefreshToken, session.tokenHash);
      if (isMatch) {
        matchedSession = session;
        break;
      }
    }

    // Nếu không khớp session nào, phát hiện có dấu hiệu Replay Attack / Token Leakage
    if (!matchedSession) {
      // Biện pháp ứng phó: Thu hồi toàn bộ phiên của tài khoản này ngay lập tức
      await this.logoutAll(userId);
      throw new ForbiddenException(
        'Phát hiện Refresh Token không hợp lệ. Toàn bộ phiên đăng nhập đã bị thu hồi để đảm bảo an toàn!',
      );
    }

    // 4. Thu hồi ngay Refresh Token cũ (Token Rotation)
    await this.prisma.refreshToken.update({
      where: { id: matchedSession.id },
      data: { isRevoked: true },
    });

    // 5. Cấp phát cặp Tokens mới và lưu Hash của Refresh Token mới
    const tokens = await this.generateTokens(user.id, user.email, user.role as Role);
    await this.saveRefreshToken(user.id, tokens.refreshToken, deviceInfo, ipAddress);

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role as Role,
        firstName: user.firstName,
        lastName: user.lastName,
      },
    };
  }

  /**
   * Đăng xuất phiên làm việc hiện tại
   */
  async logout(userId: string, rawRefreshToken?: string): Promise<MessageResponseDto> {
    if (rawRefreshToken) {
      const activeSessions = await this.prisma.refreshToken.findMany({
        where: { userId, isRevoked: false },
      });

      for (const session of activeSessions) {
        const isMatch = await this.hashingService.compare(rawRefreshToken, session.tokenHash);
        if (isMatch) {
          await this.prisma.refreshToken.update({
            where: { id: session.id },
            data: { isRevoked: true },
          });
          return { message: 'Đăng xuất thành công khỏi phiên hiện tại.', success: true };
        }
      }
    }

    // Nếu không truyền token cụ thể, thu hồi session gần nhất
    const latestSession = await this.prisma.refreshToken.findFirst({
      where: { userId, isRevoked: false },
      orderBy: { createdAt: 'desc' },
    });

    if (latestSession) {
      await this.prisma.refreshToken.update({
        where: { id: latestSession.id },
        data: { isRevoked: true },
      });
    }

    return { message: 'Đăng xuất thành công.', success: true };
  }

  /**
   * Đăng xuất khỏi tất cả các thiết bị
   */
  async logoutAll(userId: string): Promise<MessageResponseDto> {
    await this.prisma.refreshToken.updateMany({
      where: {
        userId,
        isRevoked: false,
      },
      data: {
        isRevoked: true,
      },
    });

    return {
      message: 'Đã thu hồi thành công toàn bộ các phiên đăng nhập trên mọi thiết bị.',
      success: true,
    };
  }

  /**
   * Lấy thông tin hồ sơ của người dùng hiện tại
   */
  async getProfile(userId: string): Promise<UserProfileDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('Không tìm thấy thông tin người dùng.');
    }

    if (!user.isActive) {
      throw new ForbiddenException('Tài khoản đã bị tạm khóa.');
    }

    return {
      id: user.id,
      email: user.email,
      role: user.role as Role,
      firstName: user.firstName,
      lastName: user.lastName,
      isActive: user.isActive,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  /**
   * Đổi mật khẩu tài khoản và tự động thu hồi toàn bộ session cũ
   */
  async changePassword(userId: string, dto: ChangePasswordDto): Promise<MessageResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('Không tìm thấy người dùng.');
    }

    // Kiểm tra mật khẩu hiện tại
    const isOldPasswordCorrect = await this.hashingService.compare(dto.oldPassword, user.passwordHash);
    if (!isOldPasswordCorrect) {
      throw new BadRequestException('Mật khẩu hiện tại không chính xác.');
    }

    if (dto.oldPassword === dto.newPassword) {
      throw new BadRequestException('Mật khẩu mới không được trùng với mật khẩu cũ.');
    }

    // Băm mật khẩu mới
    const newPasswordHash = await this.hashingService.hash(dto.newPassword);

    // Cập nhật CSDL trong 1 Transaction nguyên tử: Đổi mật khẩu + Revoke toàn bộ session cũ
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash: newPasswordHash },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId, isRevoked: false },
        data: { isRevoked: true },
      }),
    ]);

    return {
      message: 'Đổi mật khẩu thành công. Tất cả các phiên đăng nhập cũ đã được thu hồi an toàn.',
      success: true,
    };
  }

  // ===================== PRIVATE HELPER METHODS =====================

  /**
   * Ký số sinh cặp JWT Access Token (15m) & Refresh Token (7d)
   */
  private async generateTokens(userId: string, email: string, role: Role): Promise<Tokens> {
    const payload: JwtPayload = {
      sub: userId,
      email,
      role,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: process.env.JWT_ACCESS_SECRET || 'prm393_enterprise_access_secret_key_2026',
        expiresIn: this.ACCESS_TOKEN_EXPIRATION,
      }),
      this.jwtService.signAsync(payload, {
        secret: process.env.JWT_REFRESH_SECRET || 'prm393_enterprise_refresh_secret_key_2026',
        expiresIn: `${this.REFRESH_TOKEN_EXPIRATION_DAYS}d`,
      }),
    ]);

    return { accessToken, refreshToken };
  }

  /**
   * Băm chuỗi Refresh Token và lưu session vào PostgreSQL
   */
  private async saveRefreshToken(
    userId: string,
    rawRefreshToken: string,
    deviceInfo?: string,
    ipAddress?: string,
  ): Promise<void> {
    const tokenHash = await this.hashingService.hash(rawRefreshToken);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + this.REFRESH_TOKEN_EXPIRATION_DAYS);

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        deviceInfo: deviceInfo ?? null,
        ipAddress: ipAddress ?? null,
        expiresAt,
      },
    });
  }
}
