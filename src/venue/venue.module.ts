import { Module } from '@nestjs/common';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { Venue } from './entity/venue.entity';
import { VenueService } from './service/venue.service';
import { VenueController } from './controller/venue.controller';
import { UtilityModule } from '../utility/utility.module';

@Module({
  imports: [TenantTypeOrmModule.forFeature([Venue]), UtilityModule],
  controllers: [VenueController],
  providers: [VenueService],
  exports: [VenueService, TenantTypeOrmModule],
})
export class VenueModule {}
