import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MonthlySubscriptionsService } from './monthly-subscriptions.service';
import { SubscriptionRenewalsService } from './subscription-renewals.service';
import {
  MonthlySubscriptionsController,
  SubscriptionRenewalsController,
  VehicleChangeRequestsController,
} from './subscriptions.controllers';
import { VehicleChangeRequestsService } from './vehicle-change-requests.service';

@Module({
  imports: [AuthModule],
  controllers: [
    MonthlySubscriptionsController,
    SubscriptionRenewalsController,
    VehicleChangeRequestsController,
  ],
  providers: [MonthlySubscriptionsService, SubscriptionRenewalsService, VehicleChangeRequestsService],
})
export class SubscriptionsModule {}
