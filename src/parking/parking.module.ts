import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ParkingOperationsController, ParkingSessionsController } from './parking.controllers';
import { ParkingOperationsService } from './parking-operations.service';
import { ParkingSessionsService } from './parking-sessions.service';

@Module({
  imports: [AuthModule],
  controllers: [ParkingSessionsController, ParkingOperationsController],
  providers: [ParkingSessionsService, ParkingOperationsService],
})
export class ParkingModule {}
