import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';

@Module({
  imports: [AuthModule],
  controllers: [PaymentsController, WalletController],
  providers: [PaymentsService, WalletService],
  exports: [PaymentsService, WalletService],
})
export class PaymentsModule {}
