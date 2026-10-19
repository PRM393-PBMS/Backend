import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WalletsModule } from '../wallets/wallets.module';
import { PaymentResultController } from './payment-result.controller';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [AuthModule, WalletsModule],
  controllers: [PaymentsController, PaymentResultController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
