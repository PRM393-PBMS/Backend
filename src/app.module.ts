import { ReadinessController } from './readiness.controller';
import { BackendExceptionFilter } from './common/exception.filter';
import { FinancialIdempotencyInterceptor } from './common/idempotency.interceptor';
import { InputValidationInterceptor } from './common/input-validation.interceptor';
import { Module } from '@nestjs/common';
import { APP_GUARD, APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { AtGuard } from './auth/common/guards/at.guard';
import { CashLedgerModule } from './cash/cash-ledger.module';
import { CatalogModule } from './catalog/catalog.module';
import { GateScansModule } from './gate-scans/gate-scans.module';
import { IncidentsModule } from './incidents/incidents.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ParkingModule } from './parking/parking.module';
import { PaymentsModule } from './payments/payments.module';
import { ReportsModule } from './reports/reports.module';
import { ReservationsModule } from './reservations/reservations.module';
import { RolesModule } from './roles/roles.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { UsersModule } from './users/users.module';
import { WalletsModule } from './wallets/wallets.module';
import { VehiclesModule } from './vehicles/vehicles.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    IntegrationsModule,
    NotificationsModule,
    AuthModule,
    UsersModule,
    VehiclesModule,
    WalletsModule,
    RolesModule,
    CatalogModule,
    SubscriptionsModule,
    ReservationsModule,
    PaymentsModule,
    CashLedgerModule,
    ParkingModule,
    IncidentsModule,
    ReportsModule,
    GateScansModule,
  ],
  controllers: [AppController, ReadinessController],
  providers: [
    AppService,
    { provide: APP_FILTER, useClass: BackendExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: InputValidationInterceptor },
    { provide: APP_INTERCEPTOR, useClass: FinancialIdempotencyInterceptor },
    {
      provide: APP_GUARD,
      useClass: AtGuard,
    },
  ],
})
export class AppModule {}
