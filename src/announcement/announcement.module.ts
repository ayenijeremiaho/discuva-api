import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
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
    TypeOrmModule.forFeature([Announcement, AnnouncementReaction]),
    MemberModule,
    UtilityModule,
    GroupModule,
    SmsModule,
  ],
  providers: [AnnouncementService],
  controllers: [AnnouncementController],
  exports: [TypeOrmModule, AnnouncementService],
})
export class AnnouncementModule {}
