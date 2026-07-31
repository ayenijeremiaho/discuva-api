import { Module } from '@nestjs/common';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { ServiceRating } from './entity/service-rating.entity';
import { ServiceSlot } from '../event/entity/service-slot.entity';
import { ServiceRatingService } from './service/service-rating.service';
import { ServiceRatingController } from './controller/service-rating.controller';
import { ServiceRatingAdminController } from './controller/service-rating-admin.controller';
import { UtilityModule } from '../utility/utility.module';

@Module({
  imports: [
    TenantTypeOrmModule.forFeature([ServiceRating, ServiceSlot]),
    UtilityModule,
  ],
  providers: [ServiceRatingService],
  controllers: [ServiceRatingController, ServiceRatingAdminController],
})
export class ServiceRatingModule {}
