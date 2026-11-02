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
import { EntryPassesController } from './entry-passes.controller';
import { EntryPassesService } from './entry-passes.service';
import { FloorLayoutsController } from './floor-layouts.controller';
import { FloorLayoutsService } from './floor-layouts.service';

@Module({
  imports: [AuthModule, PaymentsModule, WalletsModule],
  controllers: [
    ParkingSessionsController,
    ParkingOperationsController,
    ParkingsController,
    EntryPassesController,
    FloorLayoutsController,
  ],
  providers: [
    EntryPassesService,
    ParkingSessionsService,
    ParkingOperationsService,
    ParkingsService,
    FloorLayoutsService,
  ],
})
export class ParkingModule {}
