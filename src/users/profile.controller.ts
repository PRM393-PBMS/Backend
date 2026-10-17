import { Body, Controller, Get, Put, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GetPbmsUserId } from '../auth/common/decorators/get-pbms-user-id.decorator';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import { PbmsStatusInterceptor } from '../common/interceptors/pbms-status.interceptor';
import { userExample } from '../common/swagger/pbms-example-data';
import { ApiPbmsOkResponse } from '../common/swagger/pbms-swagger';
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
  @ApiPbmsOkResponse('Lấy thông tin cá nhân thành công', userExample)
  getProfile(@GetPbmsUserId() userId: string): Promise<PbmsResponseDto> {
    return this.users.getProfile(userId);
  }

  @Put()
  @ApiOperation({ summary: 'Cập nhật thông tin cá nhân' })
  @ApiPbmsOkResponse('Cập nhật thông tin cá nhân thành công', userExample)
  updateProfile(
    @GetPbmsUserId() userId: string,
    @Body() dto: UpdateProfileDto,
  ): Promise<PbmsResponseDto> {
    return this.users.updateProfile(userId, dto);
  }
}
