import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Res, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { GetPbmsRole } from '../auth/common/decorators/get-pbms-role.decorator';
import { GetPbmsUserId } from '../auth/common/decorators/get-pbms-user-id.decorator';
import { PbmsRoles } from '../auth/common/decorators/pbms-roles.decorator';
import { PbmsRolesGuard } from '../auth/common/guards/pbms-roles.guard';
import { PbmsBodyDto } from '../common/dto/pbms-body.dto';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import { PbmsStatusInterceptor } from '../common/interceptors/pbms-status.interceptor';
import { ApiPbmsBodyExample } from '../common/swagger/pbms-swagger';
import { CashLedgerService } from './cash-ledger.service';

const isManager = (role: string | undefined) => ['admin', 'manager'].includes((role ?? '').toLowerCase());
const FROM_QUERY = ApiQuery({ name: 'from', required: false, description: 'ISO, mặc định đầu tháng này (giờ VN)' });
const TO_QUERY = ApiQuery({ name: 'to', required: false, description: 'ISO, không tính mốc này; mặc định đầu tháng sau' });

@ApiTags('PBMS Cash ledger')
@ApiBearerAuth('JWT-auth')
@UseGuards(PbmsRolesGuard)
@Controller('api/cash')
export class CashLedgerController {
  constructor(private readonly cash: CashLedgerService) {}

  @Get('my-holding')
  @PbmsRoles('staff', 'manager')
  @UseInterceptors(PbmsStatusInterceptor)
  @ApiOperation({ summary: 'Nhân viên: tiền mặt đang giữ và phiếu nộp chờ quản lý nhận' })
  myHolding(@GetPbmsUserId() userId: string): Promise<PbmsResponseDto> {
    return this.cash.myHolding(userId);
  }

  @Post('handovers')
  @PbmsRoles('staff', 'manager')
  @UseInterceptors(PbmsStatusInterceptor)
  @ApiOperation({ summary: 'Nhân viên chốt toàn bộ tiền mặt đang giữ thành phiếu nộp (body `reason`: ghi chú, tuỳ chọn)' })
  @ApiPbmsBodyExample(PbmsBodyDto, { reason: 'Chốt ca chiều' })
  submit(@GetPbmsUserId() userId: string, @Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.cash.submitHandover(userId, dto ?? {});
  }

  @Get('handovers')
  @PbmsRoles('staff', 'manager', 'admin')
  @UseInterceptors(PbmsStatusInterceptor)
  @ApiOperation({ summary: 'Phiếu nộp tiền trong kỳ (nhân viên chỉ thấy phiếu của mình)' })
  @FROM_QUERY
  @TO_QUERY
  @ApiQuery({ name: 'status', required: false, enum: ['Submitted', 'Confirmed', 'Rejected'] })
  @ApiQuery({ name: 'staffId', required: false })
  listHandovers(
    @GetPbmsUserId() userId: string,
    @GetPbmsRole() role: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('status') status?: string,
    @Query('staffId') staffId?: string,
  ): Promise<PbmsResponseDto> {
    return this.cash.listHandovers({ from, to, status, staffId }, { userId, isManager: isManager(role) });
  }

  @Get('handovers/:id')
  @PbmsRoles('staff', 'manager', 'admin')
  @UseInterceptors(PbmsStatusInterceptor)
  @ApiOperation({ summary: 'Chi tiết phiếu nộp tiền và các khoản trong phiếu' })
  getHandover(
    @Param('id', new ParseUUIDPipe()) id: string,
    @GetPbmsUserId() userId: string,
    @GetPbmsRole() role: string,
  ): Promise<PbmsResponseDto> {
    return this.cash.getHandover(id, { userId, isManager: isManager(role) });
  }

  @Post('handovers/:id/confirm')
  @PbmsRoles('manager', 'admin')
  @UseInterceptors(PbmsStatusInterceptor)
  @ApiOperation({ summary: 'Quản lý xác nhận đã nhận đủ tiền của phiếu' })
  @ApiPbmsBodyExample(PbmsBodyDto, { reason: 'Đã nhận đủ' })
  confirm(
    @Param('id', new ParseUUIDPipe()) id: string,
    @GetPbmsUserId() userId: string,
    @Body() dto: PbmsBodyDto,
  ): Promise<PbmsResponseDto> {
    return this.cash.review(id, userId, 'Confirmed', dto ?? {});
  }

  @Post('handovers/:id/reject')
  @PbmsRoles('manager', 'admin')
  @UseInterceptors(PbmsStatusInterceptor)
  @ApiOperation({ summary: 'Quản lý từ chối phiếu (lệch tiền); bắt buộc `reason`, các khoản trả về nhân viên giữ' })
  @ApiPbmsBodyExample(PbmsBodyDto, { reason: 'Thiếu 20.000đ so với phiếu' })
  reject(
    @Param('id', new ParseUUIDPipe()) id: string,
    @GetPbmsUserId() userId: string,
    @Body() dto: PbmsBodyDto,
  ): Promise<PbmsResponseDto> {
    return this.cash.review(id, userId, 'Rejected', dto ?? {});
  }

  @Get('ledger')
  @PbmsRoles('manager', 'admin')
  @UseInterceptors(PbmsStatusInterceptor)
  @ApiOperation({ summary: 'Sổ quỹ tiền mặt theo kỳ: tổng theo trạng thái, nhân viên, cổng; ai đang giữ bao nhiêu' })
  @FROM_QUERY
  @TO_QUERY
  @ApiQuery({ name: 'staffId', required: false })
  @ApiQuery({ name: 'gateId', required: false })
  ledger(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('staffId') staffId?: string,
    @Query('gateId') gateId?: string,
  ): Promise<PbmsResponseDto> {
    return this.cash.ledger({ from, to, staffId, gateId });
  }

  @Get('ledger/export')
  @PbmsRoles('manager', 'admin')
  @ApiOperation({ summary: 'Xuất sổ quỹ tiền mặt theo kỳ ra CSV (Excel)' })
  @FROM_QUERY
  @TO_QUERY
  async export(
    @Res() res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('staffId') staffId?: string,
    @Query('gateId') gateId?: string,
  ): Promise<void> {
    const csv = await this.cash.exportCsv({ from, to, staffId, gateId });
    if (csv instanceof PbmsResponseDto) {
      res.status(csv.statusCode).json(csv);
      return;
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="so-quy-tien-mat.csv"');
    res.send(csv);
  }
}
