import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import {
  ParkingOperationsController,
  ParkingSessionsController,
} from './parking.controllers';
import { ParkingOperationsService } from './parking-operations.service';
import { ParkingSessionsService } from './parking-sessions.service';
import { ParkingsController } from './parkings.controller';
import { ParkingsService } from './parkings.service';

@Module({
  imports: [AuthModule],
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
