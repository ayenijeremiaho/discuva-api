import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { Member } from '../member/entity/member.entity';
import { Tenant } from '../tenant/entity/tenant.entity';
import { MembershipAnniversaryService } from './service/membership-anniversary.service';
import { AnnouncementModule } from '../announcement/announcement.module';
import { UtilityModule } from '../utility/utility.module';

@Module({
  imports: [
    TenantTypeOrmModule.forFeature([Member]),
    // Tenant is public-schema, control-plane — plain TypeOrmModule, needed
    // by MembershipAnniversaryService's forEachActiveTenant loop.
    TypeOrmModule.forFeature([Tenant]),
    AnnouncementModule,
    UtilityModule,
  ],
  providers: [MembershipAnniversaryService],
})
export class MembershipAnniversaryModule {}
