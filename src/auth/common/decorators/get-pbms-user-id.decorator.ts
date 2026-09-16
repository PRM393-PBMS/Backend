import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { JwtPayload } from '../../types';

/**
 * Claim UserId trên token `/api`, fallback `sub`.
 */
export const GetPbmsUserId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as JwtPayload | undefined;
    return (user?.UserId || user?.sub || '').toString();
  },
);
