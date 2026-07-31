import { Module } from '@nestjs/common';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { ServiceHeadcount } from './entity/service-headcount.entity';
import { ServiceSlot } from '../event/entity/service-slot.entity';
import { Admin } from '../admin/entity/admin.entity';
import { AdminRole } from '../admin/entity/admin-role.entity';
import { UtilityModule } from '../utility/utility.module';
import { ServiceHeadcountService } from './service/service-headcount.service';
import { ServiceHeadcountController } from './controller/service-headcount.controller';

@Module({
  imports: [
    TenantTypeOrmModule.forFeature([
      ServiceHeadcount,
      ServiceSlot,
      Admin,
      AdminRole,
    ]),
    UtilityModule,
  ],
  controllers: [ServiceHeadcountController],
  providers: [ServiceHeadcountService],
})
export class ServiceHeadcountModule {}
