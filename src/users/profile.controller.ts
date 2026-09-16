import { Body, Controller, Get, Put, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GetPbmsUserId } from '../auth/common/decorators/get-pbms-user-id.decorator';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import { PbmsStatusInterceptor } from '../common/interceptors/pbms-status.interceptor';
import { UpdateProfileDto } from './dto/user.dto';
import { UsersService } from './users.service';

@ApiTags('PBMS Profile')
@ApiBearerAuth('JWT-auth')
@UseInterceptors(PbmsStatusInterceptor)
@Controller('api/profile')
export class ProfileController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'Lấy thông tin cá nhân' })
  getProfile(@GetPbmsUserId() userId: string): Promise<PbmsResponseDto> {
    return this.users.getProfile(userId);
  }

  @Put()
  @ApiOperation({ summary: 'Cập nhật thông tin cá nhân' })
  updateProfile(
    @GetPbmsUserId() userId: string,
    @Body() dto: UpdateProfileDto,
  ): Promise<PbmsResponseDto> {
    return this.users.updateProfile(userId, dto);
  }
}
