import { Module } from '@nestjs/common';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { Asset } from './entity/asset.entity';
import { MaintenanceSchedule } from './entity/maintenance-schedule.entity';
import { MaintenanceRecord } from './entity/maintenance-record.entity';
import { AssetCheckout } from './entity/asset-checkout.entity';
import { Department } from '../department/entity/department.entity';
import { Member } from '../member/entity/member.entity';
import { DepartmentLead } from '../department/entity/department-lead.entity';
import { AssetCheckoutNotification } from './entity/asset-checkout-notification.entity';
import { AssetService } from './service/asset.service';
import { AssetCheckoutService } from './service/asset-checkout.service';
import { AssetController } from './controller/asset.controller';
import { MaintenanceReminderScheduler } from './scheduler/maintenance-reminder.scheduler';
import { WarrantyAlertScheduler } from './scheduler/warranty-alert.scheduler';
import { VehicleExpiryAlertScheduler } from './scheduler/vehicle-expiry-alert.scheduler';
import { OverdueCheckoutScheduler } from './scheduler/overdue-checkout.scheduler';
import { UtilityModule } from '../utility/utility.module';
import { AdminModule } from '../admin/admin.module';

@Module({
  imports: [
    TenantTypeOrmModule.forFeature([
      Asset,
      MaintenanceSchedule,
      MaintenanceRecord,
      AssetCheckout,
      AssetCheckoutNotification,
      Department,
      Member,
      DepartmentLead,
    ]),
    UtilityModule,
    AdminModule,
  ],
  providers: [
    AssetService,
    AssetCheckoutService,
    MaintenanceReminderScheduler,
    WarrantyAlertScheduler,
    VehicleExpiryAlertScheduler,
    OverdueCheckoutScheduler,
  ],
  controllers: [AssetController],
})
export class AssetManagementModule {}
