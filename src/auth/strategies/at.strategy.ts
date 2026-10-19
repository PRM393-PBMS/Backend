import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtPayload } from '../types';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(private readonly prisma: PrismaService) {
    const secret = process.env.JWT_ACCESS_SECRET;
    if (!secret) throw new Error('Thiếu cấu hình JWT_ACCESS_SECRET');
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  /**
   * Hàm validate được Passport tự động gọi sau khi giải mã chữ ký Access Token thành công
   */
  async validate(payload: JwtPayload): Promise<JwtPayload> {
    if (!payload || !payload.sub || !payload.email) {
      throw new UnauthorizedException(
        'Access Token không hợp lệ hoặc thiếu thông tin định danh.',
      );
    }
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { isActive: true, status: true },
    });
    if (
      !user ||
      !user.isActive ||
      (user.status && user.status.toLowerCase() !== 'active')
    ) {
      throw new UnauthorizedException(
        'Tài khoản không còn hoạt động. Vui lòng đăng nhập lại.',
      );
    }
    return { ...payload, UserId: payload.sub };
  }
}
