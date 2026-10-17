import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { ids } from '../../common/swagger/pbms-example-data';

export class CreateRoleDto {
  @ApiPropertyOptional({ type: String, example: 'Staff' })
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
  @ApiPropertyOptional({ type: String, format: 'uuid', example: ids.roleStaffId })
  @IsOptional()
  @IsString()
  roleId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() RoleId?: string;
}
