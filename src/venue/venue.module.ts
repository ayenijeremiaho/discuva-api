import { Module } from '@nestjs/common';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { Venue } from './entity/venue.entity';
import { VenueService } from './service/venue.service';
import { VenueController } from './controller/venue.controller';
import { UtilityModule } from '../utility/utility.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from '../tenant/entity/tenant.entity';
import { NetworkVenue } from '../branch/entity/network-venue.entity';
import { NetworkVenueService } from './service/network-venue.service';

@Module({
  imports: [
    TenantTypeOrmModule.forFeature([Venue]),
    TypeOrmModule.forFeature([Tenant, NetworkVenue]),
    UtilityModule,
  ],
  controllers: [VenueController],
  providers: [VenueService, NetworkVenueService],
  exports: [VenueService, NetworkVenueService, TenantTypeOrmModule],
})
export class VenueModule {}
