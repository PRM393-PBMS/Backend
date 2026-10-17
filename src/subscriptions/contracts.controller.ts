import { Body, Controller, Get, Param, Post, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { GetPbmsRole } from '../auth/common/decorators/get-pbms-role.decorator';
import { GetPbmsUserId } from '../auth/common/decorators/get-pbms-user-id.decorator';
import { PbmsRoles } from '../auth/common/decorators/pbms-roles.decorator';
import { PbmsRolesGuard } from '../auth/common/guards/pbms-roles.guard';
import { PbmsBodyDto } from '../common/dto/pbms-body.dto';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import { PbmsStatusInterceptor } from '../common/interceptors/pbms-status.interceptor';
import { ApiPbmsBodyExample } from '../common/swagger/pbms-swagger';
import { ContractsService } from './contracts.service';
import { MonthlySubscriptionsService } from './monthly-subscriptions.service';

@ApiTags('PBMS SubscriptionContract')
@ApiBearerAuth('JWT-auth')
@UseGuards(PbmsRolesGuard)
@UseInterceptors(PbmsStatusInterceptor)
@Controller('api/contracts')
export class ContractsController {
  constructor(
    private readonly contracts: ContractsService,
    private readonly subscriptions: MonthlySubscriptionsService,
  ) {}

  @Get('my')
  @PbmsRoles('Customer', 'User')
  @ApiOperation({ summary: 'Hợp đồng vé tháng của tôi' })
  getMine(@GetPbmsUserId() userId: string): Promise<PbmsResponseDto> {
    return this.contracts.getMine(userId);
  }

  @Get('public-key')
  @PbmsRoles('Customer', 'User', 'Manager', 'Staff', 'Admin')
  @ApiOperation({ summary: 'Khoá công khai dùng để kiểm tra niêm phong hợp đồng' })
  publicKey(): PbmsResponseDto {
    return this.contracts.publicKey();
  }

  @Get('subscription/:subscriptionId')
  @PbmsRoles('Customer', 'User', 'Manager', 'Staff', 'Admin')
  @ApiOperation({ summary: 'Hợp đồng của một gói vé tháng' })
  getForSubscription(
    @Param('subscriptionId') subscriptionId: string,
    @GetPbmsUserId() userId: string,
    @GetPbmsRole() role: string,
  ): Promise<PbmsResponseDto> {
    return this.contracts.getForSubscription(subscriptionId, userId, role);
  }

  @Post(':id/sign')
  @PbmsRoles('Customer', 'User')
  @ApiOperation({ summary: 'Ký hợp đồng (chữ ký tay PNG) rồi tạo thanh toán PayOS' })
  @ApiPbmsBodyExample(PbmsBodyDto, {
    agreed: true,
    signerName: 'Nguyễn Văn A',
    contentHash: '<sha256 nội dung đã hiển thị>',
    signatureImage: 'data:image/png;base64,iVBORw0KGgo...',
  })
  async sign(
    @Param('id') id: string,
    @GetPbmsUserId() userId: string,
    @Body() dto: PbmsBodyDto,
    @Req() req: Request,
  ): Promise<PbmsResponseDto> {
    const signed = await this.contracts.sign(id, userId, dto, req.ip ?? null);
    if (!signed.isSuccess) {
      return signed;
    }
    const contract = signed.result as { subscriptionId: string };
    // Ký xong mới được thanh toán: tạo link PayOS ngay để app chuyển tiếp.
    // Lỗi PayOS không làm mất chữ ký: app có thể gọi lại POST /MonthlySubscription/payment/:id.
    let payment: PbmsResponseDto | null = null;
    let paymentError: string | null = null;
    try {
      payment = await this.subscriptions.createPayment(contract.subscriptionId, userId);
      if (!payment.isSuccess) {
        paymentError = payment.message;
      }
    } catch (error: unknown) {
      paymentError = error instanceof Error ? error.message : 'Không tạo được thanh toán';
    }
    return PbmsResponseDto.ok(signed.message ?? 'Ký hợp đồng thành công', {
      Contract: signed.result,
      Payment: payment?.isSuccess ? payment.result : null,
      PaymentError: paymentError,
    });
  }

  @Get(':id/verify')
  @PbmsRoles('Customer', 'User', 'Manager', 'Staff', 'Admin')
  @ApiOperation({ summary: 'Kiểm tra nội dung và niêm phong hợp đồng' })
  verify(
    @Param('id') id: string,
    @GetPbmsUserId() userId: string,
    @GetPbmsRole() role: string,
  ): Promise<PbmsResponseDto> {
    return this.contracts.verify(id, userId, role);
  }
}
