import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { GetPbmsUserId } from '../auth/common/decorators/get-pbms-user-id.decorator';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import { PbmsStatusInterceptor } from '../common/interceptors/pbms-status.interceptor';
import { userExample } from '../common/swagger/pbms-example-data';
import { ApiPbmsOkResponse } from '../common/swagger/pbms-swagger';
import type { UploadedImage } from '../common/uploaded-image';
import { UpdateProfileDto } from './dto/user.dto';
import { UsersService } from './users.service';

@ApiTags('PBMS Profile')
@ApiBearerAuth('JWT-auth')
@UseInterceptors(PbmsStatusInterceptor)
@Controller('api/profile')
export class ProfileController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({
    summary: 'Lấy thông tin cá nhân',
    description: [
      'JWT bắt buộc. Không body.',
      '`result`: `userId`, `userName`, `email`, `fullName`, `phoneNumber`, `status`, `roleId`, `roleName`, `avatarUrl`, `walletBalance`, `createdAt`, `updatedAt`.',
      'Lỗi: 401 nếu chưa đăng nhập; 404 nếu không tìm thấy user.',
    ].join('\n\n'),
  })
  @ApiPbmsOkResponse('Lấy thông tin cá nhân thành công', userExample)
  getProfile(@GetPbmsUserId() userId: string): Promise<PbmsResponseDto> {
    return this.users.getProfile(userId);
  }

  @Put()
  @ApiOperation({
    summary: 'Cập nhật thông tin cá nhân',
    description: [
      'JWT bắt buộc. Body JSON camelCase tuỳ chọn: `fullName`, `phoneNumber`, `email`, `password` (hash lại nếu gửi). Không đổi `roleName` / `avatarUrl` ở đây — ảnh dùng `POST /api/profile/avatar`.',
      '`result` cùng schema GET `/api/profile`.',
      'Lỗi: 401; email/SĐT trùng; email sai định dạng; 500.',
    ].join('\n\n'),
  })
  @ApiPbmsOkResponse('Cập nhật thông tin cá nhân thành công', userExample)
  updateProfile(
    @GetPbmsUserId() userId: string,
    @Body() dto: UpdateProfileDto,
  ): Promise<PbmsResponseDto> {
    return this.users.updateProfile(userId, dto);
  }

  @Post('avatar')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description:
      'multipart/form-data. Field bắt buộc `file`: JPEG, PNG hoặc WebP, tối đa 5MB. Không gửi JSON.',
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary', description: 'JPEG, PNG hoặc WebP, tối đa 5MB' },
      },
    },
  })
  @ApiOperation({
    summary: 'Cập nhật ảnh đại diện',
    description: [
      'JWT bắt buộc. `multipart/form-data`, field `file` bắt buộc: JPEG, PNG hoặc WebP, tối đa 5MB. Không JSON.',
      'File lưu dưới `/uploads/avatars/`. `result` là hồ sơ user (như GET `/api/profile`) với `avatarUrl` mới.',
      'Lỗi: 401 `Vui lòng đăng nhập`; `Vui lòng gửi file ảnh`; `Ảnh đại diện không được vượt quá 5MB`; `Ảnh đại diện chỉ nhận JPEG, PNG hoặc WebP`; 404 user; 500 lỗi lưu file.',
    ].join('\n\n'),
  })
  @ApiPbmsOkResponse('Cập nhật ảnh đại diện thành công', userExample)
  updateAvatar(
    @GetPbmsUserId() userId: string,
    @UploadedFile() file: UploadedImage,
    @Req() req: Request,
  ): Promise<PbmsResponseDto> {
    return this.users.updateAvatar(userId, file, `${req.protocol}://${req.get('host')}`);
  }
}
