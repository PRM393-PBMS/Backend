import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { JwtPayload } from '../../types';

/**
 * Tiện ích lấy trực tiếp userId (sub) từ token
 */
export const GetCurrentUserId = createParamDecorator(
  (_data: undefined, context: ExecutionContext): string => {
    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as JwtPayload | undefined;

    if (!user || !user.sub) {
      throw new UnauthorizedException('Không thể xác định danh tính người dùng từ Token.');
    }
    return user.sub;
  },
);
