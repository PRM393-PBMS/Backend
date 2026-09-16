import { CustomDecorator, SetMetadata } from '@nestjs/common';

export const PBMS_ROLES_KEY = 'pbmsRoles';

/**
 * Tên role PBMS (Admin, Manager, Staff, Customer, User, …).
 * So khớp không phân biệt hoa thường.
 */
export const PbmsRoles = (...roles: string[]): CustomDecorator<string> =>
  SetMetadata(PBMS_ROLES_KEY, roles);
