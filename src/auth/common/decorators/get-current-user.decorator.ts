import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { JwtPayloadWithRt } from '../../types';

/**
 * Trích xuất toàn bộ user object hoặc 1 thuộc tính cụ thể từ request.user (đã qua Guard)
 */
export const GetCurrentUser = createParamDecorator(
  (data: keyof JwtPayloadWithRt | undefined, context: ExecutionContext): unknown => {
    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as JwtPayloadWithRt | undefined;

    if (!user) {
      return null;
    }
    return data ? user[data] : user;
  },
);
