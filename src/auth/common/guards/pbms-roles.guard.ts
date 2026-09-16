import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { PBMS_ROLES_KEY } from '../decorators/pbms-roles.decorator';
import { JwtPayload } from '../../types';

@Injectable()
export class PbmsRolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[] | undefined>(
      PBMS_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as JwtPayload | undefined;
    const claim = (user?.role ?? '').toString().trim().toLowerCase();

    if (!claim) {
      throw new ForbiddenException(
        'Truy cập bị từ chối: Token không chứa thông tin phân quyền.',
      );
    }

    const allowed = requiredRoles.some(
      (role) => role.trim().toLowerCase() === claim,
    );
    if (!allowed) {
      throw new ForbiddenException(
        `Bạn không có quyền thực hiện hành động này. Yêu cầu quyền: [${requiredRoles.join(', ')}]`,
      );
    }

    return true;
  }
}
