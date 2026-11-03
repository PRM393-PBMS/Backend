import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CashLedgerController } from './cash-ledger.controller';
import { CashLedgerService } from './cash-ledger.service';

@Module({
  imports: [AuthModule],
  controllers: [CashLedgerController],
  providers: [CashLedgerService],
})
export class CashLedgerModule {}
