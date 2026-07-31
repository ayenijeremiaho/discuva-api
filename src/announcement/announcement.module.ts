import { Module } from '@nestjs/common';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { Announcement } from './entity/announcement.entity';
import { AnnouncementReaction } from './entity/announcement-reaction.entity';
import { AnnouncementService } from './service/announcement.service';
import { AnnouncementController } from './controller/announcement.controller';
import { MemberModule } from '../member/member.module';
import { UtilityModule } from '../utility/utility.module';
import { GroupModule } from '../group/group.module';
import { SmsModule } from '../sms/sms.module';

@Module({
  imports: [
    TenantTypeOrmModule.forFeature([Announcement, AnnouncementReaction]),
    MemberModule,
    UtilityModule,
    GroupModule,
    SmsModule,
  ],
  providers: [AnnouncementService],
  controllers: [AnnouncementController],
  exports: [TenantTypeOrmModule, AnnouncementService],
})
export class AnnouncementModule {}
