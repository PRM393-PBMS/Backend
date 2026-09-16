import { Body, Controller, HttpCode, Post, UseInterceptors } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { PbmsResponseDto } from '../../common/dto/pbms-response.dto';
import { PbmsStatusInterceptor } from '../../common/interceptors/pbms-status.interceptor';
import { PbmsAuthService } from './pbms-auth.service';
import {
  PbmsLoginDto,
  PbmsRefreshTokenDto,
  PbmsRegisterDto,
  PbmsRequestOtpDto,
  PbmsVerifyRegisterOtpDto,
  PbmsVerifyResetPasswordOtpDto,
} from './dto/pbms-auth.dto';

@ApiTags('PBMS Auth')
@Public()
@UseInterceptors(PbmsStatusInterceptor)
@Controller('api/Auth')
export class PbmsAuthController {
  constructor(private readonly pbmsAuthService: PbmsAuthService) {}

  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'PBMS login (envelope chuẩn)' })
  login(@Body() dto: PbmsLoginDto): Promise<PbmsResponseDto> {
    return this.pbmsAuthService.login(dto);
  }

  @Post('send-register-otp')
  @HttpCode(200)
  @ApiOperation({ summary: 'Gửi OTP đăng ký PBMS' })
  sendRegisterOtp(@Body() dto: PbmsRegisterDto): Promise<PbmsResponseDto> {
    return this.pbmsAuthService.sendRegisterOtp(dto);
  }

  @Post('verify-register-otp')
  @HttpCode(200)
  @ApiOperation({ summary: 'Xác thực OTP và tạo user PBMS' })
  verifyRegisterOtp(@Body() dto: PbmsVerifyRegisterOtpDto): Promise<PbmsResponseDto> {
    return this.pbmsAuthService.verifyRegisterOtp(dto);
  }

  @Post('request-reset-password')
  @HttpCode(200)
  @ApiOperation({ summary: 'Gửi OTP reset mật khẩu PBMS' })
  requestResetPassword(@Body() dto: PbmsRequestOtpDto): Promise<PbmsResponseDto> {
    return this.pbmsAuthService.requestResetPasswordOtp(dto);
  }

  @Post('verify-reset-password')
  @HttpCode(200)
  @ApiOperation({ summary: 'Xác thực OTP reset mật khẩu PBMS' })
  verifyResetPassword(@Body() dto: PbmsVerifyResetPasswordOtpDto): Promise<PbmsResponseDto> {
    return this.pbmsAuthService.verifyResetPasswordOtp(dto);
  }

  @Post('refresh-token')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cấp access token mới (không rotate refresh token)' })
  refreshToken(@Body() dto: PbmsRefreshTokenDto): Promise<PbmsResponseDto> {
    return this.pbmsAuthService.refreshToken(dto);
  }

  @Post('logout')
  @HttpCode(200)
  @ApiOperation({ summary: 'Thu hồi refresh token PBMS' })
  logout(@Body() dto: PbmsRefreshTokenDto): Promise<PbmsResponseDto> {
    return this.pbmsAuthService.logout(dto);
  }
}
