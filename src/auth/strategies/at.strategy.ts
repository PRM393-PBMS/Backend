import { PrismaService } from '../../prisma/prisma.service';
import { isUUID } from 'class-validator';
import { requiredSecret } from '../../common/config';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtPayload } from '../types';

@Injectable()
export class AtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: requiredSecret('JWT_ACCESS_SECRET'),
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
    if (!isUUID(payload.sub))
      throw new UnauthorizedException('Định danh token không hợp lệ');
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { pbmsRole: true },
    });
    if (!user || !user.isActive || user.status?.toLowerCase() !== 'active')
      throw new UnauthorizedException('Tài khoản không còn hoạt động');
    const role = user.pbmsRole?.roleName?.toLowerCase();
    if (!role || !['customer', 'staff', 'manager', 'admin'].includes(role))
      throw new UnauthorizedException('Quyền tài khoản không hợp lệ');
    return { ...payload, role, UserId: payload.sub };
  }
}
