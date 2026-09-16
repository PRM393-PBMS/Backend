import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import {
  AuthResponseDto,
  ChangePasswordDto,
  LoginDto,
  MessageResponseDto,
  OptionalRefreshTokenDto,
  RegisterDto,
  UserProfileDto,
} from './dto';
import { Public } from './common/decorators/public.decorator';
import { GetCurrentUser } from './common/decorators/get-current-user.decorator';
import { GetCurrentUserId } from './common/decorators/get-current-user-id.decorator';
import { RtGuard } from './common/guards/rt.guard';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Đăng ký tài khoản người dùng mới' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Đăng ký tài khoản thành công, trả về cặp Tokens và thông tin User',
    type: AuthResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Dữ liệu đầu vào không hợp lệ hoặc mật khẩu không đủ mạnh',
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'Email đã tồn tại trên hệ thống',
  })
  async register(
    @Body() registerDto: RegisterDto,
    @Req() req: Request,
  ): Promise<AuthResponseDto> {
    const userAgent = req.get('user-agent');
    const ipAddress = req.ip || req.socket.remoteAddress;
    return this.authService.register(registerDto, userAgent, ipAddress);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Đăng nhập vào hệ thống' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Đăng nhập thành công, trả về cặp Tokens và thông tin User',
    type: AuthResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Dữ liệu đầu vào không đúng định dạng',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Email hoặc mật khẩu không chính xác',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Tài khoản đã bị tạm khóa',
  })
  async login(
    @Body() loginDto: LoginDto,
    @Req() req: Request,
  ): Promise<AuthResponseDto> {
    const userAgent = req.get('user-agent');
    const ipAddress = req.ip || req.socket.remoteAddress;
    return this.authService.login(loginDto, userAgent, ipAddress);
  }

  @Public()
  @UseGuards(RtGuard)
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Làm mới cặp Tokens (Token Rotation)',
    description: 'Client có thể gửi Refresh Token qua Bearer Header hoặc Request Body JSON.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Cấp mới Tokens thành công',
    type: AuthResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Refresh Token không hợp lệ, đã hết hạn hoặc đã bị thu hồi',
  })
  async refresh(
    @GetCurrentUserId() userId: string,
    @GetCurrentUser('refreshToken') rtFromHeader: string,
    @Body() bodyDto: OptionalRefreshTokenDto,
    @Req() req: Request,
  ): Promise<AuthResponseDto> {
    const rawToken = bodyDto.refreshToken || rtFromHeader;
    const userAgent = req.get('user-agent');
    const ipAddress = req.ip || req.socket.remoteAddress;
    return this.authService.refreshTokens(userId, rawToken, userAgent, ipAddress);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Đăng xuất khỏi thiết bị hiện tại' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Đăng xuất thành công',
    type: MessageResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Chưa xác thực hoặc Access Token hết hạn',
  })
  async logout(
    @GetCurrentUserId() userId: string,
    @Req() req: Request,
  ): Promise<MessageResponseDto> {
    const rawRefreshToken =
      req.get('x-refresh-token') ||
      (req.body as Record<string, unknown> | undefined)?.refreshToken;
    const tokenStr = typeof rawRefreshToken === 'string' ? rawRefreshToken : undefined;
    return this.authService.logout(userId, tokenStr);
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Đăng xuất khỏi tất cả các thiết bị (Thu hồi mọi Refresh Token)' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Đã thu hồi tất cả các phiên đăng nhập',
    type: MessageResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Chưa xác thực hoặc Access Token hết hạn',
  })
  async logoutAll(@GetCurrentUserId() userId: string): Promise<MessageResponseDto> {
    return this.authService.logoutAll(userId);
  }

  @Get('me')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Lấy thông tin hồ sơ cá nhân của người dùng hiện tại' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Lấy thông tin hồ sơ thành công',
    type: UserProfileDto,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Chưa xác thực hoặc Access Token hết hạn',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Không tìm thấy người dùng',
  })
  async getProfile(@GetCurrentUserId() userId: string): Promise<UserProfileDto> {
    return this.authService.getProfile(userId);
  }

  @Patch('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Đổi mật khẩu người dùng' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Đổi mật khẩu thành công',
    type: MessageResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Mật khẩu hiện tại sai hoặc mật khẩu mới trùng mật khẩu cũ',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Chưa xác thực',
  })
  async changePassword(
    @GetCurrentUserId() userId: string,
    @Body() changePasswordDto: ChangePasswordDto,
  ): Promise<MessageResponseDto> {
    return this.authService.changePassword(userId, changePasswordDto);
  }
}
