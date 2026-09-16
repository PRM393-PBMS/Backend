import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { JwtPayload, JwtPayloadWithRt } from '../types';

@Injectable()
export class RtStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        // Ưu tiên trích xuất từ Authorization Bearer header
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        // Fallback: Trích xuất từ Request Body nếu client gửi json { "refreshToken": "..." }
        (req: Request): string | null => {
          const bodyToken = (req.body as Record<string, unknown> | undefined)?.refreshToken;
          if (typeof bodyToken === 'string' && bodyToken.trim().length > 0) {
            return bodyToken.trim();
          }
          return null;
        },
      ]),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_REFRESH_SECRET || 'prm393_enterprise_refresh_secret_key_2026',
      passReqToCallback: true,
    });
  }

  /**
   * Validate Refresh Token và trích xuất raw token kèm payload để gửi sang Service so khớp Hash
   */
  validate(req: Request, payload: JwtPayload): JwtPayloadWithRt {
    let refreshToken: string | undefined;

    const authHeader = req.get('authorization');
    if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
      refreshToken = authHeader.substring(7).trim();
    }

    if (!refreshToken && req.body) {
      const body = req.body as Record<string, unknown>;
      if (typeof body.refreshToken === 'string') {
        refreshToken = body.refreshToken.trim();
      }
    }

    if (!refreshToken) {
      throw new UnauthorizedException('Không tìm thấy Refresh Token hợp lệ trong request.');
    }

    if (!payload.sub || !payload.email) {
      throw new UnauthorizedException('Refresh Token payload không hợp lệ.');
    }

    return {
      ...payload,
      refreshToken,
    };
  }
}
