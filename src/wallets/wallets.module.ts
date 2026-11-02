import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WalletsController } from './wallets.controller';
import { PromoCodesController } from './promo-codes.controller';
import { PromoCodesService } from './promo-codes.service';
import { WalletsService } from './wallets.service';

@Module({
  imports: [AuthModule],
  controllers: [WalletsController, PromoCodesController],
  providers: [WalletsService, PromoCodesService],
  exports: [WalletsService],
})
export class WalletsModule {}
