import { ApiProperty } from '@nestjs/swagger';
import { Role } from '../enums/role.enum';

export class UserProfileDto {
  @ApiProperty({ example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d' })
  readonly id!: string;

  @ApiProperty({ example: 'engineer@prm393.fpt.edu.vn' })
  readonly email!: string;

  @ApiProperty({ enum: Role, example: Role.USER })
  readonly role!: Role;

  @ApiProperty({ example: 'Huỳnh Dũng' })
  readonly firstName!: string | null;

  @ApiProperty({ example: 'Phong' })
  readonly lastName!: string | null;

  @ApiProperty({ example: true })
  readonly isActive!: boolean;

  @ApiProperty({ example: '2026-09-10T07:00:00.000Z' })
  readonly createdAt!: Date;

  @ApiProperty({ example: '2026-09-10T07:00:00.000Z' })
  readonly updatedAt!: Date;
}
