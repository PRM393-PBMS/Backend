import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { Role } from '../../enums/role.enum';
import { JwtPayload } from '../../types';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as JwtPayload | undefined;

    if (!user || !user.role) {
      throw new ForbiddenException('Truy cập bị từ chối: Token không chứa thông tin phân quyền.');
    }

    const hasRole = requiredRoles.some((role) => role === user.role);
    if (!hasRole) {
      throw new ForbiddenException(
        `Bạn không có quyền thực hiện hành động này. Yêu cầu quyền: [${requiredRoles.join(', ')}]`,
      );
    }

    return true;
  }
}
