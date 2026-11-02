import { Body, Controller, Get, Param, Post, Put, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GetPbmsUserId } from '../auth/common/decorators/get-pbms-user-id.decorator';
import { PbmsRoles } from '../auth/common/decorators/pbms-roles.decorator';
import { PbmsRolesGuard } from '../auth/common/guards/pbms-roles.guard';
import { PbmsBodyDto } from '../common/dto/pbms-body.dto';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import { PbmsStatusInterceptor } from '../common/interceptors/pbms-status.interceptor';
import { ApiPbmsBodyExample } from '../common/swagger/pbms-swagger';
import { PromoCodesService } from './promo-codes.service';

@ApiTags('PBMS PromoCode')
@ApiBearerAuth('JWT-auth')
@UseGuards(PbmsRolesGuard)
@UseInterceptors(PbmsStatusInterceptor)
@Controller('api/PromoCode')
export class PromoCodesController {
  constructor(private readonly promos: PromoCodesService) {}

  @Get('available')
  @ApiOperation({ summary: 'Mã khuyến mãi nạp ví đang chạy (hiện ở màn nạp ví)' })
  available(): Promise<PbmsResponseDto> {
    return this.promos.available();
  }

  @Post('check')
  @ApiOperation({
    summary: 'Kiểm tra mã cho số tiền định nạp',
    description: 'Body `code`, `amount`. Lỗi 400 kèm lý do: hết hạn, hết lượt, chưa đủ mức nạp, đã dùng rồi.',
  })
  @ApiPbmsBodyExample(PbmsBodyDto, { code: 'NAP500K', amount: 500000 })
  check(@GetPbmsUserId() userId: string, @Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.promos.check(userId, dto ?? {});
  }

  @Get()
  @PbmsRoles('admin', 'manager')
  @ApiOperation({ summary: 'Quản lý: danh sách mã kèm số lượt đã dùng' })
  list(): Promise<PbmsResponseDto> {
    return this.promos.list();
  }

  @Post()
  @PbmsRoles('admin', 'manager')
  @ApiOperation({
    summary: 'Quản lý: tạo mã khuyến mãi nạp ví',
    description:
      '`code` 3-30 chữ/số (tự viết hoa), `minTopUp`, `bonusAmount` (≤ minTopUp), `bonusValidDays` (1-365, mặc định 30), `maxUses` (trống = không giới hạn), `startsAt` (mặc định bây giờ), `endsAt`.',
  })
  @ApiPbmsBodyExample(PbmsBodyDto, {
    code: 'NAP500K',
    description: 'Nạp 500k tặng 50k',
    minTopUp: 500000,
    bonusAmount: 50000,
    bonusValidDays: 30,
    maxUses: 1000,
    endsAt: '2026-12-31T16:59:59.000Z',
  })
  create(@Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.promos.create(dto ?? {});
  }

  @Put(':id')
  @PbmsRoles('admin', 'manager')
  @ApiOperation({
    summary: 'Quản lý: sửa hoặc tắt mã',
    description: 'Gửi trường cần đổi; `isActive=false` để tắt. `maxUses=0` = bỏ giới hạn. Không đổi được `code`.',
  })
  @ApiPbmsBodyExample(PbmsBodyDto, { isActive: false })
  update(@Param('id') id: string, @Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.promos.update(id, dto ?? {});
  }
}
