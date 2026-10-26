import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WalletsModule } from '../wallets/wallets.module';
import { ReservationsController } from './reservations.controller';
import { ReservationsService } from './reservations.service';

@Module({
  imports: [AuthModule, WalletsModule],
  controllers: [ReservationsController],
  providers: [ReservationsService],
})
export class ReservationsModule {}
