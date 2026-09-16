import { CustomDecorator, SetMetadata } from '@nestjs/common';
import { Role } from '../../enums/role.enum';

export const ROLES_KEY = 'roles';

/**
 * Gán quyền truy cập cho endpoint theo danh sách Role
 */
export const Roles = (...roles: Role[]): CustomDecorator<string> => SetMetadata(ROLES_KEY, roles);
