import { Body, Controller, Delete, UseInterceptors } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import { GetPbmsUserId } from '../auth/common/decorators/get-pbms-user-id.decorator';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import { PbmsStatusInterceptor } from '../common/interceptors/pbms-status.interceptor';
import { ApiPbmsOkResponse } from '../common/swagger/pbms-swagger';
import { HardDeleteAccountService } from './hard-delete-account.service';

export class HardDeleteAccountDto {
  @ApiProperty({
    description: 'Mật khẩu hiện tại để xác nhận xóa vĩnh viễn',
    writeOnly: true,
  })
  @IsString()
  @IsNotEmpty()
  password!: string;
}

@ApiTags('PBMS Profile')
@ApiBearerAuth('JWT-auth')
@UseInterceptors(PbmsStatusInterceptor)
@Controller('api/profile')
export class AccountDeletionController {
  constructor(private readonly deletion: HardDeleteAccountService) {}

  @Delete('account')
  @ApiOperation({
    summary: 'Xóa vĩnh viễn tài khoản của tôi',
    description:
      'JWT và mật khẩu hiện tại bắt buộc. Xóa bản ghi user, xe và lịch sử thuộc tài khoản trong database. Trả 409 nếu còn ví khác 0 hoặc nghiệp vụ chưa hoàn tất. Muốn sử dụng lại phải đăng ký mới.',
  })
  @ApiPbmsOkResponse('Đã xóa vĩnh viễn tài khoản', null)
  remove(
    @GetPbmsUserId() userId: string,
    @Body() dto: HardDeleteAccountDto,
  ): Promise<PbmsResponseDto> {
    return this.deletion.remove(userId, dto.password);
  }
}
