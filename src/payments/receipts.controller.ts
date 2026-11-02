import { Body, Controller, Get, Param, Post, Put, Query, Res, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { GetPbmsRole } from '../auth/common/decorators/get-pbms-role.decorator';
import { GetPbmsUserId } from '../auth/common/decorators/get-pbms-user-id.decorator';
import { PbmsRoles } from '../auth/common/decorators/pbms-roles.decorator';
import { Public } from '../auth/common/decorators/public.decorator';
import { PbmsRolesGuard } from '../auth/common/guards/pbms-roles.guard';
import { PbmsBodyDto } from '../common/dto/pbms-body.dto';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import { PbmsStatusInterceptor } from '../common/interceptors/pbms-status.interceptor';
import { ApiPbmsBodyExample } from '../common/swagger/pbms-swagger';
import { ReceiptsService } from './receipts.service';

@ApiTags('PBMS Receipt')
@ApiBearerAuth('JWT-auth')
@UseGuards(PbmsRolesGuard)
@Controller('api/receipts')
export class ReceiptsController {
  constructor(private readonly receipts: ReceiptsService) {}

  @Get('invoice-requests')
  @PbmsRoles('admin', 'manager')
  @UseInterceptors(PbmsStatusInterceptor)
  @ApiOperation({ summary: 'Kế toán/quản lý: yêu cầu xuất hoá đơn GTGT (lọc `status=Pending|Issued`)' })
  listInvoiceRequests(@Query('status') status?: string): Promise<PbmsResponseDto> {
    return this.receipts.listInvoiceRequests(status?.trim() || undefined);
  }

  @Put('invoice-requests/:id')
  @PbmsRoles('admin', 'manager')
  @UseInterceptors(PbmsStatusInterceptor)
  @ApiOperation({ summary: 'Kế toán/quản lý: ghi số hoá đơn đã xuất, báo khách' })
  @ApiPbmsBodyExample(PbmsBodyDto, { invoiceNo: '00001234' })
  markIssued(@Param('id') id: string, @Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.receipts.markIssued(id, dto ?? {});
  }

  @Get(':paymentId/link')
  @UseInterceptors(PbmsStatusInterceptor)
  @ApiOperation({
    summary: 'Link tải biên nhận PDF (hết hạn sau 10 phút)',
    description: 'Chủ thanh toán hoặc quản lý; chỉ thanh toán `Success`. App mở `url` bằng trình duyệt.',
  })
  link(
    @Param('paymentId') paymentId: string,
    @GetPbmsUserId() userId: string,
    @GetPbmsRole() role: string,
  ): Promise<PbmsResponseDto> {
    return this.receipts.link(paymentId, userId, role ?? '');
  }

  @Post(':paymentId/invoice-request')
  @UseInterceptors(PbmsStatusInterceptor)
  @ApiOperation({
    summary: 'Yêu cầu xuất hoá đơn GTGT cho một thanh toán',
    description: 'Body `companyName`, `taxCode` (10 số hoặc 10-3), `address`, `email`. Sửa được khi chưa xuất.',
  })
  @ApiPbmsBodyExample(PbmsBodyDto, {
    companyName: 'Công ty TNHH ABC',
    taxCode: '0312345678',
    address: '12 Nguyễn Huệ, Quận 1, TP.HCM',
    email: 'ketoan@abc.vn',
  })
  requestInvoice(
    @Param('paymentId') paymentId: string,
    @GetPbmsUserId() userId: string,
    @Body() dto: PbmsBodyDto,
  ): Promise<PbmsResponseDto> {
    return this.receipts.requestInvoice(paymentId, userId, dto ?? {});
  }

  @Public()
  @Get(':paymentId/pdf')
  @ApiOperation({ summary: 'Tải biên nhận PDF bằng link đã ký (không cần JWT)' })
  async pdf(
    @Param('paymentId') paymentId: string,
    @Query('exp') exp: string,
    @Query('sig') sig: string,
    @Res() res: Response,
  ): Promise<void> {
    const pdf = await this.receipts.renderPdf(paymentId, exp, sig);
    if (!pdf) {
      res.status(404).type('text/plain; charset=utf-8').send('Link biên nhận không hợp lệ hoặc đã hết hạn.');
      return;
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="bien-nhan-${paymentId.slice(0, 8)}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(pdf);
  }
}
