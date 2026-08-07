import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { RentalFacility } from './entity/rental-facility.entity';
import { RentalPricingTier } from './entity/rental-pricing-tier.entity';
import { RentalAddon } from './entity/rental-addon.entity';
import { RentalBooking } from './entity/rental-booking.entity';
import { RentalBookingAddon } from './entity/rental-booking-addon.entity';
import { RentalPayment } from './entity/rental-payment.entity';
import { RentalCalendarBlock } from './entity/rental-calendar-block.entity';
import { Asset } from '../asset-management/entity/asset.entity';
import { Member } from '../member/entity/member.entity';
import { DepartmentLead } from '../department/entity/department-lead.entity';
import { WorkerProfile } from '../member/entity/worker-profile.entity';
import { RentalConfigService } from './service/rental-config.service';
import { RentalBookingService } from './service/rental-booking.service';
import { RentalAdminService } from './service/rental-admin.service';
import { RentalAdminController } from './controller/rental-admin.controller';
import { RentalMemberController } from './controller/rental-member.controller';
import { RentalStatusScheduler } from './scheduler/rental-status.scheduler';
import { UtilityModule } from '../utility/utility.module';
import { Tenant } from '../tenant/entity/tenant.entity';

@Module({
  imports: [
    TenantTypeOrmModule.forFeature([
      RentalFacility,
      RentalPricingTier,
      RentalAddon,
      RentalBooking,
      RentalBookingAddon,
      RentalPayment,
      RentalCalendarBlock,
      Asset,
      Member,
      DepartmentLead,
      WorkerProfile,
    ]),
    // Tenant is public-schema, control-plane — plain TypeOrmModule, needed
    // by RentalStatusScheduler's forEachActiveTenant loop.
    TypeOrmModule.forFeature([Tenant]),
    UtilityModule,
  ],
  providers: [
    RentalConfigService,
    RentalBookingService,
    RentalAdminService,
    RentalStatusScheduler,
  ],
  controllers: [RentalAdminController, RentalMemberController],
  exports: [RentalBookingService, RentalConfigService],
})
export class FacilityRentalModule {}
