import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PbmsAuthController } from './pbms/pbms-auth.controller';
import { PbmsAuthService } from './pbms/pbms-auth.service';
import { HashingService } from './services/hashing.service';
import { MailService } from './services/mail.service';
import { OtpStoreService } from './services/otp-store.service';
import { AtStrategy } from './strategies/at.strategy';
import { RtStrategy } from './strategies/rt.strategy';
import { AtGuard } from './common/guards/at.guard';
import { RtGuard } from './common/guards/rt.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { PbmsRolesGuard } from './common/guards/pbms-roles.guard';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({}),
  ],
  controllers: [AuthController, PbmsAuthController],
  providers: [
    AuthService,
    PbmsAuthService,
    HashingService,
    MailService,
    OtpStoreService,
    AtStrategy,
    RtStrategy,
    AtGuard,
    RtGuard,
    RolesGuard,
    PbmsRolesGuard,
  ],
  exports: [AuthService, HashingService, PbmsRolesGuard],
})
export class AuthModule {}
