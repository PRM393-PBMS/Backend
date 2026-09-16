import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtPayload } from '../types';

@Injectable()
export class AtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_ACCESS_SECRET || 'prm393_enterprise_access_secret_key_2026',
    });
  }

  /**
   * Hàm validate được Passport tự động gọi sau khi giải mã chữ ký Access Token thành công
   */
  validate(payload: JwtPayload): JwtPayload {
    if (!payload || !payload.sub || !payload.email) {
      throw new UnauthorizedException('Access Token không hợp lệ hoặc thiếu thông tin định danh.');
    }
    return payload;
  }
}
