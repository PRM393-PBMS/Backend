import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PaymentsModule } from '../payments/payments.module';
import { WalletsModule } from '../wallets/wallets.module';
import {
  ParkingOperationsController,
  ParkingSessionsController,
} from './parking.controllers';
import { ParkingOperationsService } from './parking-operations.service';
import { ParkingSessionsService } from './parking-sessions.service';
import { ParkingsController } from './parkings.controller';
import { ParkingsService } from './parkings.service';

@Module({
  imports: [AuthModule, PaymentsModule, WalletsModule],
  controllers: [
    ParkingSessionsController,
    ParkingOperationsController,
    ParkingsController,
  ],
  providers: [
    ParkingSessionsService,
    ParkingOperationsService,
    ParkingsService,
  ],
})
export class ParkingModule {}
