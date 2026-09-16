import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { JwtPayload } from '../../types';

/** Claim `role` trên token `/api` (roleName PBMS). */
export const GetPbmsRole = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as JwtPayload | undefined;
    return (user?.role ?? '').toString();
  },
);
