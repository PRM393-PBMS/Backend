import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/** Login body — nhận camelCase và PascalCase. */
export class PbmsLoginDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  Email?: string;

  @ApiPropertyOptional()
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
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  userName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  UserName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fullName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  FullName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  Email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  PhoneNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  password?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  Password?: string;

  @ApiPropertyOptional()
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
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  Email?: string;

  @ApiPropertyOptional()
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
  @ApiPropertyOptional()
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
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  Email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  otp?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  Otp?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  newPassword?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  NewPassword?: string;

  @ApiPropertyOptional()
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
  @ApiProperty({ description: 'Refresh token (refreshTokenKey)' })
  @IsOptional()
  @IsString()
  refreshTokenKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  RefreshTokenKey?: string;
}
