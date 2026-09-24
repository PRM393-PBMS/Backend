import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../auth/common/decorators/public.decorator';
import { PbmsRoles } from '../auth/common/decorators/pbms-roles.decorator';
import { PbmsRolesGuard } from '../auth/common/guards/pbms-roles.guard';
import { PbmsBodyDto } from '../common/dto/pbms-body.dto';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import { PbmsStatusInterceptor } from '../common/interceptors/pbms-status.interceptor';
import { ids, paymentExample } from '../common/swagger/pbms-example-data';
import { ApiPbmsBodyExample, ApiPbmsOkResponse } from '../common/swagger/pbms-swagger';
import { PaymentsService } from './payments.service';

@ApiTags('PBMS Payments')
@Controller('api/payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Public()
  @Post('payos-webhook')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Webhook PayOS (thành công: HTTP 200 body rỗng)',
    description:
      'Public (không JWT) — chỉ PayOS gọi. Xác nhận thanh toán: nạp ví (`WalletTopUp` cộng `walletBalance` + ghi Credit) hoặc gói tháng/gia hạn. Thành công: HTTP 200, body rỗng (không envelope PBMS). Lỗi xử lý: HTTP 500 JSON `{ statusCode, message, isSuccess: false }`. FE không gọi API này; FE poll ví/gói hoặc đợi redirect PayOS rồi GET lại.',
  })
  async webhook(@Body() body: Record<string, unknown>, @Res() res: Response): Promise<void> {
    try {
      await this.payments.handleWebhook(body ?? {});
      res.status(200).send();
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Lỗi xử lý webhook PayOS';
      res.status(500).json({
        statusCode: 500,
        message: message.startsWith('Lỗi xử lý webhook')
          ? message
          : `Lỗi xử lý webhook PayOS: ${message}`,
        isSuccess: false,
      });
    }
  }

  @ApiBearerAuth('JWT-auth')
  @UseGuards(PbmsRolesGuard)
  @PbmsRoles('manager')
  @UseInterceptors(PbmsStatusInterceptor)
  @Get()
  @ApiOperation({ summary: 'Danh sách thanh toán' })
  @ApiPbmsOkResponse('Lấy danh sách thanh toán thành công', [paymentExample])
  getAll(): Promise<PbmsResponseDto> {
    return this.payments.getAll();
  }

  @ApiBearerAuth('JWT-auth')
  @UseGuards(PbmsRolesGuard)
  @PbmsRoles('manager')
  @UseInterceptors(PbmsStatusInterceptor)
  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết thanh toán' })
  @ApiPbmsOkResponse('Lấy thông tin thanh toán thành công', paymentExample)
  getById(@Param('id') id: string): Promise<PbmsResponseDto> {
    return this.payments.getById(id);
  }

  @ApiBearerAuth('JWT-auth')
  @UseGuards(PbmsRolesGuard)
  @PbmsRoles('manager')
  @UseInterceptors(PbmsStatusInterceptor)
  @Post()
  @ApiOperation({ summary: 'Tạo thanh toán' })
  @ApiPbmsBodyExample(PbmsBodyDto, {
    userId: ids.userId,
    sessionId: ids.sessionId,
    amount: 11000,
    paymentMethod: 'Cash',
    paymentType: 'CheckoutFee',
    paymentStatus: 'Success',
    paymentTime: '2026-09-17T11:45:00.000Z',
    transactionReference: 'CASH-20260917-01',
  })
  @ApiPbmsOkResponse('Tạo thanh toán thành công', paymentExample, 201)
  create(@Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.payments.create(dto);
  }

  @ApiBearerAuth('JWT-auth')
  @UseGuards(PbmsRolesGuard)
  @PbmsRoles('manager')
  @UseInterceptors(PbmsStatusInterceptor)
  @Put()
  @ApiOperation({ summary: 'Cập nhật thanh toán' })
  @ApiPbmsBodyExample(PbmsBodyDto, {
    paymentId: ids.paymentId,
    amount: 11000,
    paymentMethod: 'Cash',
    paymentStatus: 'Success',
  })
  @ApiPbmsOkResponse('Cập nhật thanh toán thành công', paymentExample)
  update(@Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.payments.update(dto);
  }

  @ApiBearerAuth('JWT-auth')
  @UseGuards(PbmsRolesGuard)
  @PbmsRoles('manager')
  @UseInterceptors(PbmsStatusInterceptor)
  @Delete(':id')
  @ApiOperation({ summary: 'Xóa thanh toán' })
  @ApiPbmsOkResponse('Xóa thanh toán thành công', null)
  remove(@Param('id') id: string): Promise<PbmsResponseDto> {
    return this.payments.remove(id);
  }
}
