import { Role } from '../enums/role.enum';

export interface JwtPayload {
  readonly sub: string;
  readonly email: string;
  /** Nest `/auth/*`: USER|ADMIN|MODERATOR. PBMS `/api/*`: Role.roleName (User, Manager, …). */
  readonly role: Role | string;
  readonly nestRole?: Role;
  readonly UserId?: string;
  readonly UserName?: string;
  readonly Email?: string;
  readonly RoleId?: string;
  readonly iat?: number;
  readonly exp?: number;
}

export interface JwtPayloadWithRt extends JwtPayload {
  readonly refreshToken: string;
}

export interface Tokens {
  readonly accessToken: string;
  readonly refreshToken: string;
}
