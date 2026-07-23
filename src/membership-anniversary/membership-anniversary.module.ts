import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Member } from '../member/entity/member.entity';
import { MembershipAnniversaryService } from './service/membership-anniversary.service';
import { AnnouncementModule } from '../announcement/announcement.module';
import { UtilityModule } from '../utility/utility.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Member]),
    AnnouncementModule,
    UtilityModule,
  ],
  providers: [MembershipAnniversaryService],
})
export class MembershipAnniversaryModule {}
