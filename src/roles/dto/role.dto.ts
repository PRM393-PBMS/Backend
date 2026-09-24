import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class CreateRoleDto {
  @ApiPropertyOptional({ type: String, example: 'staff' })
  @IsOptional()
  @IsString()
  roleName?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() RoleName?: string;

  @ApiPropertyOptional({ type: String, example: 'Nhân viên vận hành bãi xe' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() Description?: string;
}

export class UpdateRoleDto extends CreateRoleDto {
  @ApiPropertyOptional({ type: Number, example: 2 })
  @IsOptional()
  roleId?: number;

  @ApiPropertyOptional() @IsOptional() RoleId?: number | string;
}
