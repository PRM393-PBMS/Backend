import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../auth/common/decorators/public.decorator';
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

  @Get('cancel')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  async cancel(@Query('orderCode') orderCode?: string): Promise<string> {
    return renderPaymentResultPage(await this.payments.resultForOrderCode(orderCode, true));
  }
}
