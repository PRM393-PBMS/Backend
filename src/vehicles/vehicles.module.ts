import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { VehiclesController } from './vehicles.controller';
import { VehiclesService } from './vehicles.service';
import { PlateScanService } from './plate-scan.service';

@Module({
  imports: [AuthModule],
  controllers: [VehiclesController],
  providers: [VehiclesService, PlateScanService],
})
export class VehiclesModule {}
