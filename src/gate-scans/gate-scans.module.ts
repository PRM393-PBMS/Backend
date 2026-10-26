import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GateScansController } from './gate-scans.controller';
import { GateScansService } from './gate-scans.service';

@Module({
  imports: [AuthModule],
  controllers: [GateScansController],
  providers: [GateScansService],
  exports: [GateScansService],
})
export class GateScansModule {}
