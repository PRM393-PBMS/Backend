import { Controller, Delete, Get, Param, Put, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GetPbmsUserId } from '../auth/common/decorators/get-pbms-user-id.decorator';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import { PbmsStatusInterceptor } from '../common/interceptors/pbms-status.interceptor';
import { NotificationsService } from './notifications.service';

/** Thông báo của người dùng đang đăng nhập (chỉ đọc / xoá được thông báo của chính mình). */
@ApiTags('PBMS Notification')
@ApiBearerAuth('JWT-auth')
@UseInterceptors(PbmsStatusInterceptor)
@Controller('api/Notification')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('my')
  @ApiOperation({ summary: 'Thông báo của tôi (50 thông báo mới nhất + số chưa đọc)' })
  getMine(@GetPbmsUserId() userId: string): Promise<PbmsResponseDto> {
    return this.notifications.getMine(userId);
  }

  // Đặt trước ':id/read' để "read-all" không bị hiểu là một id.
  @Put('read-all')
  @ApiOperation({ summary: 'Đánh dấu tất cả thông báo đã đọc' })
  markAllRead(@GetPbmsUserId() userId: string): Promise<PbmsResponseDto> {
    return this.notifications.markAllRead(userId);
  }

  @Put(':id/read')
  @ApiOperation({ summary: 'Đánh dấu một thông báo đã đọc' })
  markRead(@GetPbmsUserId() userId: string, @Param('id') id: string): Promise<PbmsResponseDto> {
    return this.notifications.markRead(userId, id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Xoá một thông báo' })
  remove(@GetPbmsUserId() userId: string, @Param('id') id: string): Promise<PbmsResponseDto> {
    return this.notifications.remove(userId, id);
  }
}
