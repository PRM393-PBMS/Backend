import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../auth/common/decorators/public.decorator';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import { renderPaymentResultPage } from './payment-result.page';
import { PaymentsService } from './payments.service';

/**
 * Trang PayOS chuyển khách về (returnUrl / cancelUrl). Công khai vì mở trong trình
 * duyệt, không có token; trạng thái luôn được hỏi lại PayOS, không tin tham số trên URL.
 */
@ApiExcludeController()
@Public()
@Controller('payment')
export class PaymentResultController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('success')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  async success(@Query('orderCode') orderCode?: string): Promise<string> {
    return renderPaymentResultPage(await this.payments.resultForOrderCode(orderCode, false));
  }

  /**
   * Kết quả dạng JSON cho trang kết quả trong app (Flutter, kể cả bản web):
   * { state: success | pending | cancelled | failed | unknown, orderCode, amount, typeLabel }.
   */
  @Get('result')
  @Header('Cache-Control', 'no-store')
  async result(
    @Query('orderCode') orderCode?: string,
    @Query('cancel') cancel?: string,
  ): Promise<PbmsResponseDto> {
    const view = await this.payments.resultForOrderCode(orderCode, cancel === 'true');
    return PbmsResponseDto.ok('Lấy kết quả thanh toán thành công', view);
  }

  @Get('cancel')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  async cancel(@Query('orderCode') orderCode?: string): Promise<string> {
    return renderPaymentResultPage(await this.payments.resultForOrderCode(orderCode, true));
  }
}
