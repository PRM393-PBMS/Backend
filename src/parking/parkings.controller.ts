import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
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
import { PbmsRolesGuard } from '../auth/common/guards/pbms-roles.guard';
import {
  CreateParkingDto,
  ParkingIdParamDto,
  ParkingResponseDto,
  ParkingSlotResponseDto,
  UpdateParkingDto,
} from './dto/parking.dto';
import { ParkingsService } from './parkings.service';

const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);

@ApiTags('Parking')
@ApiBearerAuth('JWT-auth')
@UseGuards(PbmsRolesGuard)
@Controller('parkings')
export class ParkingsController {
  constructor(
    private readonly parkings: ParkingsService,
    private readonly files: FilesService,
  ) {}

  @Post()
  @PbmsRoles('manager')
  @ApiOperation({ summary: 'Tạo bãi đỗ' })
  create(@Body() dto: CreateParkingDto): Promise<ParkingResponseDto> {
    return this.parkings.create(dto);
  }

  @Get()
  @PbmsRoles('manager', 'staff')
  @ApiOperation({ summary: 'Danh sách bãi đỗ' })
  findAll(): Promise<ParkingResponseDto[]> {
    return this.parkings.findAll();
  }

  // Đặt trước các route ':id' để 'available' không bị hiểu là id.
  @Get('available')
  @PbmsRoles('customer', 'manager', 'staff', 'admin')
  @ApiOperation({
    summary: 'Bãi đỗ cho app khách hàng: toạ độ và chỗ trống theo loại xe',
    description:
      'Mỗi phần tử: parkingId, name, location, latitude/longitude (null nếu chưa nhập), imageUrl, openingHours (null nếu chưa nhập), totalSlots, availableSlots, availability[{vehicleTypeId, vehicleTypeName, totalSlots, availableSlots}].',
  })
  listAvailable() {
    return this.parkings.listForCustomers();
  }

  @Get(':id/slots')
  @PbmsRoles('manager', 'staff')
  @ApiOperation({ summary: 'Danh sách ô đỗ của một bãi' })
  findSlots(
    @Param() params: ParkingIdParamDto,
  ): Promise<ParkingSlotResponseDto[]> {
    return this.parkings.findSlots(params.id);
  }

  @Get(':id')
  @PbmsRoles('manager', 'staff')
  @ApiOperation({ summary: 'Chi tiết bãi đỗ' })
  findOne(@Param() params: ParkingIdParamDto): Promise<ParkingResponseDto> {
    return this.parkings.findOne(params.id);
  }

  @Patch(':id')
  @PbmsRoles('manager')
  @ApiOperation({ summary: 'Cập nhật tên hoặc địa điểm bãi đỗ' })
  update(
    @Param() params: ParkingIdParamDto,
    @Body() dto: UpdateParkingDto,
  ): Promise<ParkingResponseDto> {
    return this.parkings.update(params.id, dto);
  }

  @Post(':id/image')
  @PbmsRoles('manager')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] },
  })
  @ApiOperation({
    summary: 'Tải ảnh bãi (hiện trên thẻ bãi ở app khách)',
    description: 'Field `file`: JPEG, PNG hoặc WebP, tối đa 5MB. Trả về bãi đã cập nhật `imageUrl`.',
  })
  async uploadImage(
    @Param() params: ParkingIdParamDto,
    @UploadedFile() file: UploadedImage | undefined,
    @Req() req: Request,
  ): Promise<ParkingResponseDto> {
    if (!file) {
      throw new BadRequestException('Vui lòng gửi file ảnh');
    }
    if (file.buffer.length > IMAGE_MAX_BYTES) {
      throw new BadRequestException('Ảnh bãi không được vượt quá 5MB');
    }
    const ext = extname(file.originalname || '').toLowerCase();
    if (!IMAGE_EXT.has(ext) || !IMAGE_MIME.has((file.mimetype ?? '').toLowerCase())) {
      throw new BadRequestException('Ảnh bãi chỉ nhận JPEG, PNG hoặc WebP');
    }
    await this.parkings.findOne(params.id);
    const upload = await this.files.saveUpload(file, `${req.protocol}://${req.get('host')}`, 'parkings');
    return this.parkings.update(params.id, { imageUrl: upload.imageUrl });
  }

  @Delete(':id')
  @PbmsRoles('manager')
  @ApiOperation({ summary: 'Xóa bãi đỗ không còn ô đỗ' })
  remove(@Param() params: ParkingIdParamDto): Promise<ParkingResponseDto> {
    return this.parkings.remove(params.id);
  }
}
