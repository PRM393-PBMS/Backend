import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { GetPbmsUserId } from '../auth/common/decorators/get-pbms-user-id.decorator';
import { Public } from '../auth/common/decorators/public.decorator';
import { PbmsRoles } from '../auth/common/decorators/pbms-roles.decorator';
import { PbmsRolesGuard } from '../auth/common/guards/pbms-roles.guard';
import { PbmsBodyDto } from '../common/dto/pbms-body.dto';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import { PbmsStatusInterceptor } from '../common/interceptors/pbms-status.interceptor';
import { ids, paymentExample } from '../common/swagger/pbms-example-data';
import {
  ApiPbmsBodyExample,
  ApiPbmsOkResponse,
} from '../common/swagger/pbms-swagger';
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
      'Public (không JWT) — chỉ PayOS gọi. Xác nhận thanh toán: nạp ví (`WalletTopUp` cộng `wallets.balance` + ghi Credit) hoặc gói tháng/gia hạn. Thành công: HTTP 200, body rỗng (không envelope PBMS). Lỗi xử lý: HTTP 500 JSON `{ statusCode, message, isSuccess: false }`. FE không gọi API này; FE poll ví/gói hoặc đợi redirect PayOS rồi GET lại.',
  })
  async webhook(
    @Body() body: Record<string, unknown>,
    @Res() res: Response,
  ): Promise<void> {
    await this.payments.handleWebhook(body ?? {});
    res.status(200).send();
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
  @UseInterceptors(PbmsStatusInterceptor)
  @Get('my')
  @ApiOperation({
    summary: 'Lịch sử thanh toán của tôi (có phân trang)',
    description: [
      'JWT bắt buộc. Chỉ trả thanh toán của user trong token: tiền cọc đặt chỗ, phí gửi xe, vé tháng, gia hạn, nạp ví — mọi phương thức (PayOS, Wallet, Cash).',
      'Query: `page` (từ 1, mặc định 1), `pageSize` (1–50, mặc định 20), `status` (`Pending`|`Success`|`Failed`, tuỳ chọn). Mới nhất trước.',
      '`result`: `items` (schema như GET `/api/payments/{id}` + `paymentTypeLabel`, `licensePlate`, `packageName`), `page`, `pageSize`, `total`, `hasMore`.',
      'Lỗi: 401; 400 `status` không hợp lệ.',
    ].join('\n\n'),
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['Pending', 'Success', 'Failed'],
  })
  @ApiPbmsOkResponse('Lấy lịch sử thanh toán thành công', {
    items: [
      {
        ...paymentExample,
        paymentTypeLabel: 'Vé tháng',
        licensePlate: '59A12345',
        packageName: 'Gói tháng xe máy',
      },
    ],
    page: 1,
    pageSize: 20,
    total: 1,
    hasMore: false,
  })
  getMine(
    @GetPbmsUserId() userId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: string,
  ): Promise<PbmsResponseDto> {
    return this.payments.getMine(userId, page, pageSize, status);
  }

  @ApiBearerAuth('JWT-auth')
  @UseGuards(PbmsRolesGuard)
  @PbmsRoles('customer')
  @UseInterceptors(PbmsStatusInterceptor)
  @Get(':id/sync')
  @ApiOperation({
    summary: 'Khách kiểm tra thanh toán PayOS của mình (tra trực tiếp PayOS)',
    description:
      'Dùng cho nút "Tôi đã thanh toán" khi webhook chưa tới (nạp ví, thanh toán trước khi ra bãi, gói tháng). Thành công thì cộng ví / cấp mã ra cổng / kích hoạt gói đúng một lần.',
  })
  syncMine(
    @Param('id') id: string,
    @GetPbmsUserId() userId: string,
  ): Promise<PbmsResponseDto> {
    return this.payments.syncMine(id, userId);
  }

  @ApiBearerAuth('JWT-auth')
  @UseGuards(PbmsRolesGuard)
  @PbmsRoles('manager')
  @UseInterceptors(PbmsStatusInterceptor)
  @Get('reconciliation')
  @ApiOperation({ summary: 'Danh sách thanh toán cần đối soát (manager)' })
  reconciliation(): Promise<PbmsResponseDto> {
    return this.payments.getReconciliation();
  }

  @ApiBearerAuth('JWT-auth')
  @UseGuards(PbmsRolesGuard)
  @PbmsRoles('manager')
  @UseInterceptors(PbmsStatusInterceptor)
  @Post(':id/reconcile')
  @ApiOperation({
    summary:
      'Quản lý đối soát một thanh toán PayOS đang chờ (tra trực tiếp PayOS)',
    description:
      'Dùng khi webhook PayOS tới trễ hoặc bị mất. Đã thanh toán thì xử lý đúng một lần (cộng ví / cấp mã ra cổng / kích hoạt gói). Trả về thanh toán sau đối soát.',
  })
  async reconcile(@Param('id') id: string): Promise<PbmsResponseDto> {
    const found = await this.payments.getById(id);
    if (!found.isSuccess) {
      return found;
    }
    try {
      await this.payments.syncPayosPayment(id);
    } catch (error: unknown) {
      return PbmsResponseDto.fromError(error);
    }
    return this.payments.getById(id);
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
  @ApiOperation({ summary: 'Thanh toán phải tạo qua luồng nghiệp vụ (409)' })
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
  @ApiResponse({
    status: 409,
    description: 'USE_PAYMENT_WORKFLOW: dùng luồng nghiệp vụ thanh toán',
  })
  create(@Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.payments.create(dto);
  }

  @ApiBearerAuth('JWT-auth')
  @UseGuards(PbmsRolesGuard)
  @PbmsRoles('manager')
  @UseInterceptors(PbmsStatusInterceptor)
  @Put()
  @ApiOperation({
    summary: 'Đổi trạng thái qua đồng bộ PayOS/xác nhận tiền mặt (409)',
  })
  @ApiPbmsBodyExample(PbmsBodyDto, {
    paymentId: ids.paymentId,
    amount: 11000,
    paymentMethod: 'Cash',
    paymentStatus: 'Success',
  })
  @ApiResponse({
    status: 409,
    description:
      'USE_PAYMENT_WORKFLOW: dùng đồng bộ PayOS hoặc xác nhận tiền mặt',
  })
  update(@Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.payments.update(dto);
  }

  @ApiBearerAuth('JWT-auth')
  @UseGuards(PbmsRolesGuard)
  @PbmsRoles('manager')
  @UseInterceptors(PbmsStatusInterceptor)
  @Delete(':id')
  @ApiOperation({ summary: 'Chứng từ thanh toán được bảo toàn (409)' })
  @ApiResponse({
    status: 409,
    description: 'PAYMENT_HISTORY_PROTECTED: bảo toàn chứng từ',
  })
  remove(@Param('id') id: string): Promise<PbmsResponseDto> {
    return this.payments.remove(id);
  }
}
