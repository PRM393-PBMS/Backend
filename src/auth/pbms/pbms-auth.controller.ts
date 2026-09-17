import { Body, Controller, HttpCode, Post, UseInterceptors } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { PbmsResponseDto } from '../../common/dto/pbms-response.dto';
import { PbmsStatusInterceptor } from '../../common/interceptors/pbms-status.interceptor';
import {
  dummyAccessToken,
  ids,
  loginResultExample,
  PBMS_REGISTER_EXAMPLE,
} from '../../common/swagger/pbms-example-data';
import { ApiPbmsBodyExample, ApiPbmsOkResponse } from '../../common/swagger/pbms-swagger';
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
  @ApiPbmsBodyExample(PbmsLoginDto, {
    email: PBMS_REGISTER_EXAMPLE.email,
    password: PBMS_REGISTER_EXAMPLE.password,
  })
  @ApiPbmsOkResponse('Đăng nhập thành công', loginResultExample)
  login(@Body() dto: PbmsLoginDto): Promise<PbmsResponseDto> {
    return this.pbmsAuthService.login(dto);
  }

  @Post('send-register-otp')
  @HttpCode(200)
  @ApiOperation({ summary: 'Gửi OTP đăng ký PBMS' })
  @ApiBody({
    type: PbmsRegisterDto,
    examples: {
      default: { value: PBMS_REGISTER_EXAMPLE },
    },
  })
  @ApiPbmsOkResponse('Nếu email tồn tại, OTP đã được gửi', null)
  sendRegisterOtp(@Body() dto: PbmsRegisterDto): Promise<PbmsResponseDto> {
    return this.pbmsAuthService.sendRegisterOtp(dto);
  }

  @Post('verify-register-otp')
  @HttpCode(200)
  @ApiOperation({ summary: 'Xác thực OTP và tạo user PBMS' })
  @ApiPbmsBodyExample(PbmsVerifyRegisterOtpDto, { email: PBMS_REGISTER_EXAMPLE.email, otp: '482917' })
  @ApiPbmsOkResponse('Đăng ký thành công', { userId: ids.userId })
  verifyRegisterOtp(@Body() dto: PbmsVerifyRegisterOtpDto): Promise<PbmsResponseDto> {
    return this.pbmsAuthService.verifyRegisterOtp(dto);
  }

  @Post('request-reset-password')
  @HttpCode(200)
  @ApiOperation({ summary: 'Gửi OTP reset mật khẩu PBMS' })
  @ApiPbmsBodyExample(PbmsRequestOtpDto, { email: PBMS_REGISTER_EXAMPLE.email })
  @ApiPbmsOkResponse('Nếu email tồn tại, OTP đã được gửi', null)
  requestResetPassword(@Body() dto: PbmsRequestOtpDto): Promise<PbmsResponseDto> {
    return this.pbmsAuthService.requestResetPasswordOtp(dto);
  }

  @Post('verify-reset-password')
  @HttpCode(200)
  @ApiOperation({ summary: 'Xác thực OTP reset mật khẩu PBMS' })
  @ApiPbmsBodyExample(PbmsVerifyResetPasswordOtpDto, {
    email: PBMS_REGISTER_EXAMPLE.email,
    otp: '482917',
    newPassword: PBMS_REGISTER_EXAMPLE.password,
    confirmPassword: PBMS_REGISTER_EXAMPLE.confirmPassword,
  })
  @ApiPbmsOkResponse('Đặt lại mật khẩu thành công', null)
  verifyResetPassword(@Body() dto: PbmsVerifyResetPasswordOtpDto): Promise<PbmsResponseDto> {
    return this.pbmsAuthService.verifyResetPasswordOtp(dto);
  }

  @Post('refresh-token')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cấp access token mới (không rotate refresh token)' })
  @ApiPbmsOkResponse('Cấp token mới thành công', { accessToken: dummyAccessToken })
  refreshToken(@Body() dto: PbmsRefreshTokenDto): Promise<PbmsResponseDto> {
    return this.pbmsAuthService.refreshToken(dto);
  }

  @Post('logout')
  @HttpCode(200)
  @ApiOperation({ summary: 'Thu hồi refresh token PBMS' })
  @ApiPbmsOkResponse('Đăng xuất thành công', null)
  logout(@Body() dto: PbmsRefreshTokenDto): Promise<PbmsResponseDto> {
    return this.pbmsAuthService.logout(dto);
  }
}
