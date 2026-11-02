import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { extname } from 'path';
import type { UploadedImage } from '../common/uploaded-image';
import { FilesService } from '../integrations/payos-files.service';
import { PbmsRoles } from '../auth/common/decorators/pbms-roles.decorator';
import { Public } from '../auth/common/decorators/public.decorator';
import { PbmsRolesGuard } from '../auth/common/guards/pbms-roles.guard';
import { PbmsBodyDto } from '../common/dto/pbms-body.dto';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import { PbmsStatusInterceptor } from '../common/interceptors/pbms-status.interceptor';
import { FloorLayoutsService } from './floor-layouts.service';

const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);

@ApiTags('PBMS FloorLayout')
@ApiBearerAuth('JWT-auth')
@UseGuards(PbmsRolesGuard)
@UseInterceptors(PbmsStatusInterceptor)
@Controller('api/FloorLayout')
export class FloorLayoutsController {
  constructor(
    private readonly layouts: FloorLayoutsService,
    private readonly files: FilesService,
  ) {}

  @Public()
  @Get('parking/:parkingId')
  @ApiOperation({ summary: 'Sơ đồ đã xuất bản của các tầng trong bãi (app khách vẽ và chỉ đường)' })
  published(@Param('parkingId', new ParseUUIDPipe()) parkingId: string): Promise<PbmsResponseDto> {
    return this.layouts.published(parkingId);
  }

  @Get(':floorId/draft')
  @PbmsRoles('admin')
  @ApiOperation({ summary: 'Admin: bản vẽ đang sửa của tầng (nháp, hoặc bản đã xuất bản) kèm version' })
  draft(@Param('floorId', new ParseUUIDPipe()) floorId: string): Promise<PbmsResponseDto> {
    return this.layouts.draft(floorId);
  }

  @Put(':floorId/draft')
  @PbmsRoles('admin')
  @ApiOperation({
    summary: 'Admin: lưu nháp sơ đồ (không ảnh hưởng vận hành)',
    description: 'Body `{ version, layout: { w, h, cells: [{x, y, t, ...}], bg? } }`. Sai version thì 409 kèm version mới.',
  })
  saveDraft(@Param('floorId', new ParseUUIDPipe()) floorId: string, @Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.layouts.saveDraft(floorId, dto ?? {});
  }

  @Post(':floorId/publish')
  @PbmsRoles('admin')
  @ApiOperation({
    summary: 'Admin: xuất bản sơ đồ, đồng bộ ô đỗ và cổng theo sơ đồ',
    description:
      'Body `{ version }`. Kiểm tra mọi chỗ đỗ có lối đi tới từ cổng vào, mã ô không trùng trong bãi, dốc nối đúng tầng, ' +
      'không xoá ô đang có xe/giữ cho vé tháng. Lỗi thì 400 kèm `problems`.',
  })
  publish(@Param('floorId', new ParseUUIDPipe()) floorId: string, @Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.layouts.publish(floorId, dto ?? {});
  }

  @Post(':floorId/background')
  @PbmsRoles('admin')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] } })
  @ApiOperation({ summary: 'Admin: tải ảnh mặt bằng làm nền để vẽ theo. Trả `url`, client tự gắn vào bản nháp.' })
  async background(
    @Param('floorId', new ParseUUIDPipe()) _floorId: string,
    @UploadedFile() file: UploadedImage | undefined,
    @Req() req: Request,
  ): Promise<PbmsResponseDto> {
    if (!file) throw new BadRequestException('Vui lòng gửi file ảnh');
    if (file.buffer.length > IMAGE_MAX_BYTES) throw new BadRequestException('Ảnh không được vượt quá 5MB');
    const ext = extname(file.originalname || '').toLowerCase();
    if (!IMAGE_EXT.has(ext) || !IMAGE_MIME.has((file.mimetype ?? '').toLowerCase())) {
      throw new BadRequestException('Ảnh nền chỉ nhận JPEG, PNG hoặc WebP');
    }
    const upload = await this.files.saveUpload(file, `${req.protocol}://${req.get('host')}`, 'floor-plans');
    return PbmsResponseDto.ok('Đã tải ảnh nền', { url: upload.imageUrl });
  }
}
