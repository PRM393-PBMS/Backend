import { Body, Controller, Get, Param, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GetPbmsUserId } from '../auth/common/decorators/get-pbms-user-id.decorator';
import { PbmsRoles } from '../auth/common/decorators/pbms-roles.decorator';
import { PbmsRolesGuard } from '../auth/common/guards/pbms-roles.guard';
import { PbmsBodyDto } from '../common/dto/pbms-body.dto';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import { PbmsStatusInterceptor } from '../common/interceptors/pbms-status.interceptor';
import { ApiPbmsBodyExample } from '../common/swagger/pbms-swagger';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from './payments.service';
import { WalletService } from './wallet.service';

@ApiTags('PBMS Wallet')
@ApiBearerAuth('JWT-auth')
@UseGuards(PbmsRolesGuard)
@UseInterceptors(PbmsStatusInterceptor)
@Controller('api/wallet')
export class WalletController {
  constructor(
    private readonly wallet: WalletService,
    private readonly payments: PaymentsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('my')
  @PbmsRoles('Customer', 'User')
  @ApiOperation({ summary: 'Số dư và lịch sử giao dịch ví của tôi' })
  getMine(@GetPbmsUserId() userId: string): Promise<PbmsResponseDto> {
    return this.wallet.getMine(userId);
  }

  @Post('top-up')
  @PbmsRoles('Customer', 'User')
  @ApiOperation({ summary: 'Nạp tiền vào ví qua PayOS' })
  @ApiPbmsBodyExample(PbmsBodyDto, { amount: 100000 })
  topUp(@GetPbmsUserId() userId: string, @Body() dto: PbmsBodyDto): Promise<PbmsResponseDto> {
    return this.wallet.createTopUp(userId, dto);
  }

  @Get('top-up/:paymentId/status')
  @PbmsRoles('Customer', 'User')
  @ApiOperation({ summary: 'Kiểm tra lệnh nạp ví (tra trực tiếp PayOS)' })
  async topUpStatus(
    @Param('paymentId') paymentId: string,
    @GetPbmsUserId() userId: string,
  ): Promise<PbmsResponseDto> {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, userId, paymentType: 'WalletTopUp' },
    });
    if (!payment) {
      return PbmsResponseDto.fail('Không tìm thấy lệnh nạp ví', 404);
    }
    try {
      const status = await this.payments.syncPayosPayment(payment.id);
      return PbmsResponseDto.ok('Lấy trạng thái nạp ví thành công', {
        paymentId: payment.id,
        paymentStatus: status,
        balance: await this.wallet.balanceOf(userId),
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Lỗi tra cứu PayOS';
      return PbmsResponseDto.fail(`Không kiểm tra được thanh toán: ${message}`, 502);
    }
  }
}
