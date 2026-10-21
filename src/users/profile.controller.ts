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
import {
  ChangePasswordBodyDto,
  DeleteAccountBodyDto,
  RequestEmailChangeBodyDto,
  UpdateProfileDto,
  VerifyEmailChangeBodyDto,
} from './dto/user.dto';
import { EmailChangeService } from './email-change.service';
import { UsersService } from './users.service';

@ApiTags('PBMS Profile')
@ApiBearerAuth('JWT-auth')
@UseInterceptors(PbmsStatusInterceptor)
@Controller('api/profile')
export class ProfileController {
  constructor(
    private readonly users: UsersService,
    private readonly emailChange: EmailChangeService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Lấy thông tin cá nhân',
    description: [
      'JWT bắt buộc. Không body.',
      '`result`: `userId`, `userName`, `email`, `fullName`, `phoneNumber`, `status`, `roleId`, `roleName`, `avatarUrl`, `walletId` (UUID hoặc null), `createdAt`, `updatedAt`. Không trả số dư ví — FE dùng `walletId` để gọi `/api/wallet/{walletId}`.',
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
      'JWT bắt buộc. Body JSON camelCase tuỳ chọn: `fullName`, `phoneNumber`. Không đổi `roleName` / `avatarUrl` ở đây — ảnh dùng `POST /api/profile/avatar`.',
      'Không đổi thông tin đăng nhập ở đây: gửi `password` bị từ chối (dùng `POST /api/profile/change-password`); `email` khác email hiện tại bị từ chối (dùng `POST /api/profile/change-email`).',
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

  @Post('delete-account')
  @ApiOperation({
    summary: 'Xoá tài khoản của tôi',
    description: [
      'JWT bắt buộc. Body: `password` để xác nhận.',
      'Từ chối (409) khi còn xe trong bãi, vé tháng còn hiệu lực / chờ thanh toán, đặt chỗ chưa kết thúc, thanh toán đang chờ hoặc số dư ví > 0.',
      'Ẩn danh hoá hồ sơ (email, tên, SĐT, ảnh), khoá đăng nhập, thu hồi phiên, xoá thông báo, huỷ mã vào bãi, xoá xe chưa từng dùng. Lịch sử gửi xe, thanh toán, hợp đồng được giữ theo quy định lưu chứng từ.',
    ].join('\n\n'),
  })
  @ApiPbmsOkResponse('Đã xoá tài khoản', null)
  deleteAccount(
    @GetPbmsUserId() userId: string,
    @Body() dto: DeleteAccountBodyDto,
  ): Promise<PbmsResponseDto> {
    return this.users.deleteAccount(userId, dto);
  }

  @Post('change-password')
  @ApiOperation({
    summary: 'Đổi mật khẩu',
    description: [
      'JWT bắt buộc. Body: `currentPassword`, `newPassword` (6-72 ký tự, khác mật khẩu cũ).',
      'Đổi thành công thì mọi refresh token cũ bị thu hồi (các thiết bị khác phải đăng nhập lại).',
      'Lỗi: 400 sai mật khẩu hiện tại / mật khẩu mới không hợp lệ; 401; 404.',
    ].join('\n\n'),
  })
  @ApiPbmsOkResponse('Đổi mật khẩu thành công', null)
  changePassword(
    @GetPbmsUserId() userId: string,
    @Body() dto: ChangePasswordBodyDto,
  ): Promise<PbmsResponseDto> {
    return this.users.changePassword(userId, dto);
  }

  @Post('change-email')
  @ApiOperation({
    summary: 'Đổi email — bước 1: gửi OTP tới email mới',
    description: [
      'JWT bắt buộc. Body: `newEmail`, `password` (mật khẩu hiện tại). Gửi mã 6 số tới **email mới**, hiệu lực 10 phút. Email chưa đổi cho tới khi xác nhận ở bước 2.',
      'Lỗi: 400 thiếu dữ liệu / sai định dạng / sai mật khẩu / trùng email hiện tại / email đã được dùng; 401; 404; 500 không gửi được mail.',
    ].join('\n\n'),
  })
  @ApiPbmsOkResponse('Đã gửi mã xác nhận tới email mới', { newEmail: 'email.moi@gmail.com' })
  requestEmailChange(
    @GetPbmsUserId() userId: string,
    @Body() dto: RequestEmailChangeBodyDto,
  ): Promise<PbmsResponseDto> {
    return this.emailChange.request(userId, dto);
  }

  @Post('change-email/verify')
  @ApiOperation({
    summary: 'Đổi email — bước 2: xác nhận OTP',
    description: [
      'JWT bắt buộc. Body: `otp`. Đúng mã thì email đăng nhập đổi sang email mới (đánh dấu đã xác minh).',
      'Sai mã quá 5 lần thì mã bị huỷ, phải gửi lại bước 1.',
      'Lỗi: 400 thiếu mã / mã sai / hết hạn / email đã bị tài khoản khác dùng; 401.',
    ].join('\n\n'),
  })
  @ApiPbmsOkResponse('Đổi email thành công', { email: 'email.moi@gmail.com' })
  verifyEmailChange(
    @GetPbmsUserId() userId: string,
    @Body() dto: VerifyEmailChangeBodyDto,
  ): Promise<PbmsResponseDto> {
    return this.emailChange.verify(userId, dto);
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
