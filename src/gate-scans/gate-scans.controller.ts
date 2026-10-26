import {
  Body,
  Controller,
  Get,
  MessageEvent,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Sse,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import { GetPbmsUserId } from '../auth/common/decorators/get-pbms-user-id.decorator';
import { PbmsRoles } from '../auth/common/decorators/pbms-roles.decorator';
import { PbmsRolesGuard } from '../auth/common/guards/pbms-roles.guard';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import { PbmsStatusInterceptor } from '../common/interceptors/pbms-status.interceptor';
import type { UploadedImage } from '../common/uploaded-image';
import { GateScansService } from './gate-scans.service';

const MAX_BYTES = 8 * 1024 * 1024;
const IMAGE_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

/** Điện thoại nhân viên làm máy quét biển số; web staff nhận lượt quét real-time và xử lý. */
@ApiTags('PBMS GateScan')
@ApiBearerAuth('JWT-auth')
@UseGuards(PbmsRolesGuard)
@PbmsRoles('staff', 'manager')
@Controller('api/GateScan')
export class GateScansController {
  constructor(private readonly scans: GateScansService) {}

  @Post()
  @UseInterceptors(PbmsStatusInterceptor, FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'gateId'],
      properties: {
        file: { type: 'string', format: 'binary', description: 'Ảnh biển số: JPEG, PNG hoặc WebP, tối đa 8MB' },
        gateId: { type: 'string', format: 'uuid', description: 'Cổng nhân viên đang đứng quét' },
        capturedAt: { type: 'string', format: 'date-time', description: 'Giờ chụp trên điện thoại (ISO 8601)' },
      },
    },
  })
  @ApiOperation({
    summary: 'Gửi một lượt quét biển số từ điện thoại',
    description:
      'Lưu ảnh, nhận diện biển số, đối chiếu đặt chỗ / gói tháng / phiên đang mở, rồi phát sự kiện `scan` trên `GET /api/GateScan/stream`. Nhân viên quét lấy từ token.',
  })
  create(
    @GetPbmsUserId() staffId: string,
    @UploadedFile() file: UploadedImage | undefined,
    @Body() body: { gateId?: string; capturedAt?: string },
    @Req() req: Request,
  ): Promise<PbmsResponseDto> {
    if (!file?.buffer?.length) {
      return Promise.resolve(PbmsResponseDto.fail('Vui lòng gửi ảnh biển số'));
    }
    if (!IMAGE_MIME.has((file.mimetype ?? '').toLowerCase())) {
      return Promise.resolve(PbmsResponseDto.fail('Ảnh chỉ nhận JPEG, PNG hoặc WebP'));
    }
    return this.scans.create(staffId, file, {
      gateId: body?.gateId?.trim(),
      capturedAt: body?.capturedAt,
      baseUrl: `${req.protocol}://${req.get('host')}`,
    });
  }

  @Sse('stream')
  @ApiOperation({
    summary: 'Luồng real-time (SSE) các lượt quét',
    description:
      'Server-Sent Events. `gateId` để chỉ nhận lượt quét của một cổng. Sự kiện: `scan` (lượt quét mới), `scan-updated` (đổi trạng thái), `ping` (giữ kết nối mỗi 25 giây). Gửi token qua header `Authorization` (đọc bằng fetch, không dùng EventSource).',
  })
  stream(@Query('gateId') gateId?: string): Observable<MessageEvent> {
    return this.scans.stream(gateId?.trim() || undefined);
  }

  @Get('recent')
  @UseInterceptors(PbmsStatusInterceptor)
  @ApiOperation({
    summary: 'Lượt quét gần đây',
    description: '`gateId` lọc theo cổng; `mine=true` chỉ lượt quét của tôi; `limit` 1-100 (mặc định 20).',
  })
  recent(
    @GetPbmsUserId() staffId: string,
    @Query('gateId') gateId?: string,
    @Query('mine') mine?: string,
    @Query('limit') limit?: string,
  ): Promise<PbmsResponseDto> {
    return this.scans.recent({
      gateId: gateId?.trim() || undefined,
      staffId: mine === 'true' ? staffId : undefined,
      limit: Number(limit) || 20,
    });
  }

  @Patch(':id/status')
  @UseInterceptors(PbmsStatusInterceptor)
  @ApiOperation({ summary: 'Đánh dấu lượt quét: New, Handled (đã check-in/checkout) hoặc Dismissed (bỏ qua)' })
  setStatus(@Param('id') id: string, @Body() body: { status?: string }): Promise<PbmsResponseDto> {
    return this.scans.setStatus(id, body?.status);
  }
}
