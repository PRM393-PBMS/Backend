import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { ids, PBMS_REGISTER_EXAMPLE } from '../../common/swagger/pbms-example-data';

export class CreateUserDto {
  @ApiPropertyOptional({ type: String, example: PBMS_REGISTER_EXAMPLE.userName })
  @IsOptional()
  @IsString()
  userName?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() UserName?: string;

  @ApiPropertyOptional({ type: String, format: 'email', example: PBMS_REGISTER_EXAMPLE.email })
  @IsOptional()
  @IsString()
  email?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() Email?: string;

  @ApiPropertyOptional({ type: String, example: PBMS_REGISTER_EXAMPLE.password })
  @IsOptional()
  @IsString()
  password?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() Password?: string;

  @ApiPropertyOptional({ type: String, example: PBMS_REGISTER_EXAMPLE.fullName })
  @IsOptional()
  @IsString()
  fullName?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() FullName?: string;

  @ApiPropertyOptional({ type: String, example: PBMS_REGISTER_EXAMPLE.phoneNumber })
  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() PhoneNumber?: string;

  @ApiPropertyOptional({ type: String, format: 'uuid', example: ids.roleStaffId })
  @IsOptional()
  @IsString()
  roleId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() RoleId?: string;

  @ApiPropertyOptional({ type: String, example: 'Staff' })
  @IsOptional()
  @IsString()
  roleName?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() RoleName?: string;
}

export class UpdateUserDto extends CreateUserDto {
  @ApiPropertyOptional({ type: String, format: 'uuid', example: ids.userId })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() UserId?: string;
}

export class UpdateUserStatusDto {
  @ApiPropertyOptional({ type: String, example: 'Active', enum: ['Active', 'Inactive', 'Banned'] })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() Status?: string;
}

export class UpdateProfileDto {
  @ApiPropertyOptional({ type: String, example: PBMS_REGISTER_EXAMPLE.fullName })
  @IsOptional()
  @IsString()
  fullName?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() FullName?: string;

  @ApiPropertyOptional({ type: String, example: PBMS_REGISTER_EXAMPLE.phoneNumber })
  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() PhoneNumber?: string;

  @ApiPropertyOptional({ type: String, format: 'email', example: PBMS_REGISTER_EXAMPLE.email })
  @IsOptional()
  @IsString()
  email?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() Email?: string;

  @ApiPropertyOptional({ type: String, example: PBMS_REGISTER_EXAMPLE.password })
  @IsOptional()
  @IsString()
  password?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() Password?: string;
}
