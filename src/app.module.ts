import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { AtGuard } from './auth/common/guards/at.guard';
import { CatalogModule } from './catalog/catalog.module';
import { IncidentsModule } from './incidents/incidents.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { ParkingModule } from './parking/parking.module';
import { PaymentsModule } from './payments/payments.module';
import { ReportsModule } from './reports/reports.module';
import { ReservationsModule } from './reservations/reservations.module';
import { RolesModule } from './roles/roles.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { UsersModule } from './users/users.module';
import { WalletsModule } from './wallets/wallets.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    IntegrationsModule,
    AuthModule,
    UsersModule,
    WalletsModule,
    RolesModule,
    CatalogModule,
    SubscriptionsModule,
    ReservationsModule,
    PaymentsModule,
    ParkingModule,
    IncidentsModule,
    ReportsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: AtGuard,
    },
  ],
})
export class AppModule {}
