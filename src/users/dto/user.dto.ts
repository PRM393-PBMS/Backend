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

  @ApiPropertyOptional({ type: Number, example: 2 })
  @IsOptional()
  roleId?: number;

  @ApiPropertyOptional() @IsOptional() RoleId?: number | string;

  @ApiPropertyOptional({ type: String, example: 'staff' })
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

  @ApiPropertyOptional({
    type: String,
    format: 'email',
    description: 'Chỉ chấp nhận đúng email hiện tại; đổi email dùng POST /api/profile/change-email.',
  })
  @IsOptional()
  @IsString()
  email?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() Email?: string;

  @ApiPropertyOptional({ deprecated: true, description: 'Bị từ chối; đổi mật khẩu dùng POST /api/profile/change-password.' })
  @IsOptional()
  @IsString()
  password?: string;

  @ApiPropertyOptional({ deprecated: true }) @IsOptional() @IsString() Password?: string;
}

/** Bước 1 đổi email: email mới + mật khẩu hiện tại. */
export class RequestEmailChangeBodyDto {
  @ApiPropertyOptional({ type: String, format: 'email', example: 'email.moi@gmail.com' })
  @IsOptional()
  @IsString()
  newEmail?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() NewEmail?: string;

  @ApiPropertyOptional({ type: String, example: 'MatKhau@123' })
  @IsOptional()
  @IsString()
  password?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() Password?: string;
}

/** Bước 2 đổi email: mã OTP gửi tới email mới. */
export class VerifyEmailChangeBodyDto {
  @ApiPropertyOptional({ type: String, example: '123456' })
  @IsOptional()
  @IsString()
  otp?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() Otp?: string;
}

/** Đổi mật khẩu: phải nhập đúng mật khẩu hiện tại. */
export class ChangePasswordBodyDto {
  @ApiPropertyOptional({ type: String, example: 'MatKhauCu@123' })
  @IsOptional()
  @IsString()
  currentPassword?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() CurrentPassword?: string;

  @ApiPropertyOptional({ type: String, example: 'MatKhauMoi@456' })
  @IsOptional()
  @IsString()
  newPassword?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() NewPassword?: string;
}

/** Xoá tài khoản: nhập lại mật khẩu để xác nhận. */
export class DeleteAccountBodyDto {
  @ApiPropertyOptional({ type: String, example: 'MatKhau@123' })
  @IsOptional()
  @IsString()
  password?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() Password?: string;
}
