import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import {
  dummyRefreshToken,
  PBMS_REGISTER_EXAMPLE,
} from '../../../common/swagger/pbms-example-data';

/** Login body — nhận camelCase và PascalCase. */
export class PbmsLoginDto {
  @ApiPropertyOptional({
    type: String,
    format: 'email',
    example: PBMS_REGISTER_EXAMPLE.email,
  })
  @IsOptional()
  @IsString()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  Email?: string;

  @ApiPropertyOptional({ type: String, example: PBMS_REGISTER_EXAMPLE.password })
  @IsOptional()
  @IsString()
  password?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  Password?: string;
}

/** Body đăng ký OTP. */
export class PbmsRegisterDto {
  @ApiPropertyOptional({ type: String, example: PBMS_REGISTER_EXAMPLE.userName })
  @IsOptional()
  @IsString()
  userName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  UserName?: string;

  @ApiPropertyOptional({ type: String, example: PBMS_REGISTER_EXAMPLE.fullName })
  @IsOptional()
  @IsString()
  fullName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  FullName?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'email',
    example: PBMS_REGISTER_EXAMPLE.email,
  })
  @IsOptional()
  @IsString()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  Email?: string;

  @ApiPropertyOptional({ type: String, example: PBMS_REGISTER_EXAMPLE.phoneNumber })
  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  PhoneNumber?: string;

  @ApiPropertyOptional({ type: String, example: PBMS_REGISTER_EXAMPLE.password })
  @IsOptional()
  @IsString()
  password?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  Password?: string;

  @ApiPropertyOptional({ type: String, example: PBMS_REGISTER_EXAMPLE.confirmPassword })
  @IsOptional()
  @IsString()
  confirmPassword?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ConfirmPassword?: string;
}

/** Body xác thực OTP đăng ký. */
export class PbmsVerifyRegisterOtpDto {
  @ApiPropertyOptional({
    type: String,
    format: 'email',
    example: PBMS_REGISTER_EXAMPLE.email,
  })
  @IsOptional()
  @IsString()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  Email?: string;

  @ApiPropertyOptional({ type: String, example: '482917' })
  @IsOptional()
  @IsString()
  otp?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  Otp?: string;
}

/** Body yêu cầu OTP. */
export class PbmsRequestOtpDto {
  @ApiPropertyOptional({
    type: String,
    format: 'email',
    example: PBMS_REGISTER_EXAMPLE.email,
  })
  @IsOptional()
  @IsString()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  Email?: string;
}

/** Body xác thực OTP reset mật khẩu. */
export class PbmsVerifyResetPasswordOtpDto {
  @ApiPropertyOptional({
    type: String,
    format: 'email',
    example: PBMS_REGISTER_EXAMPLE.email,
  })
  @IsOptional()
  @IsString()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  Email?: string;

  @ApiPropertyOptional({ type: String, example: '482917' })
  @IsOptional()
  @IsString()
  otp?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  Otp?: string;

  @ApiPropertyOptional({ type: String, example: PBMS_REGISTER_EXAMPLE.password })
  @IsOptional()
  @IsString()
  newPassword?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  NewPassword?: string;

  @ApiPropertyOptional({ type: String, example: PBMS_REGISTER_EXAMPLE.confirmPassword })
  @IsOptional()
  @IsString()
  confirmPassword?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ConfirmPassword?: string;
}

/** RefreshTokenDTO */
export class PbmsRefreshTokenDto {
  @ApiProperty({
    description: 'Refresh token (refreshTokenKey)',
    type: String,
    example: dummyRefreshToken,
  })
  @IsOptional()
  @IsString()
  refreshTokenKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  RefreshTokenKey?: string;
}
