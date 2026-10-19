import { Body, Controller, Delete, Get, Param, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GetPbmsUserId } from '../auth/common/decorators/get-pbms-user-id.decorator';
import { PbmsRoles } from '../auth/common/decorators/pbms-roles.decorator';
import { PbmsRolesGuard } from '../auth/common/guards/pbms-roles.guard';
import { PbmsBodyDto } from '../common/dto/pbms-body.dto';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import { PbmsStatusInterceptor } from '../common/interceptors/pbms-status.interceptor';
import { EntryPassesService } from './entry-passes.service';

/** Mã QR gửi xe một lần của khách hàng. */
@ApiTags('PBMS EntryPass')
@ApiBearerAuth('JWT-auth')
@UseGuards(PbmsRolesGuard)
@PbmsRoles('customer')
@UseInterceptors(PbmsStatusInterceptor)
@Controller('api/entry-passes')
export class EntryPassesController {
  constructor(private readonly passes: EntryPassesService) {}

  @Post()
  @ApiOperation({
    summary: 'Tạo mã QR vào bãi một lần cho xe của tôi',
    description:
      'Body: `vehicleId`. Mã hiệu lực 24 giờ, dùng một lần ở cổng vào (check-in với `qrPayload`). Tạo mã mới sẽ huỷ mã cũ còn hiệu lực của cùng xe.',
  })
  create(@GetPbmsUserId() userId: string, @Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.passes.create(userId, dto);
  }

  @Get('my')
  @ApiOperation({ summary: 'Mã vào bãi của tôi (20 mã gần nhất)' })
  getMine(@GetPbmsUserId() userId: string): Promise<PbmsResponseDto> {
    return this.passes.getMine(userId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Huỷ mã vào bãi còn hiệu lực' })
  cancel(@GetPbmsUserId() userId: string, @Param('id') id: string): Promise<PbmsResponseDto> {
    return this.passes.cancel(userId, id);
  }
}
