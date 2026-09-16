import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import {
  FloorsController,
  GatesController,
  ParkingSlotsController,
  PricingPoliciesController,
  SubscriptionPackagesController,
  VehicleTypesController,
} from './catalog.controllers';
import { FloorsService } from './floors.service';
import { GatesService } from './gates.service';
import { ParkingSlotsService } from './parking-slots.service';
import { PricingPoliciesService } from './pricing-policies.service';
import { SubscriptionPackagesService } from './subscription-packages.service';
import { VehicleTypesService } from './vehicle-types.service';

@Module({
  imports: [AuthModule],
  controllers: [
    VehicleTypesController,
    FloorsController,
    GatesController,
    ParkingSlotsController,
    PricingPoliciesController,
    SubscriptionPackagesController,
  ],
  providers: [
    VehicleTypesService,
    FloorsService,
    GatesService,
    ParkingSlotsService,
    PricingPoliciesService,
    SubscriptionPackagesService,
  ],
})
export class CatalogModule {}
