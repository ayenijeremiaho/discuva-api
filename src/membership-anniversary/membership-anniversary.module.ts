import { Module } from '@nestjs/common';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { Member } from '../member/entity/member.entity';
import { MembershipAnniversaryService } from './service/membership-anniversary.service';
import { AnnouncementModule } from '../announcement/announcement.module';
import { UtilityModule } from '../utility/utility.module';

@Module({
  imports: [
    TenantTypeOrmModule.forFeature([Member]),
    AnnouncementModule,
    UtilityModule,
  ],
  providers: [MembershipAnniversaryService],
})
export class MembershipAnniversaryModule {}
