import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class CreateRoleDto {
  @ApiPropertyOptional() @IsOptional() @IsString() roleName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() RoleName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() Description?: string;
}

export class UpdateRoleDto extends CreateRoleDto {
  @ApiPropertyOptional() @IsOptional() @IsString() roleId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() RoleId?: string;
}
