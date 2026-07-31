import { Module } from '@nestjs/common';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { BirthdayWish } from './entity/birthday-wish.entity';
import { BirthdayService } from './service/birthday.service';
import { BirthdayController } from './controller/birthday.controller';
import { MemberModule } from '../member/member.module';
import { AnnouncementModule } from '../announcement/announcement.module';
import { UtilityModule } from '../utility/utility.module';

@Module({
  imports: [
    TenantTypeOrmModule.forFeature([BirthdayWish]),
    MemberModule,
    AnnouncementModule,
    UtilityModule,
  ],
  providers: [BirthdayService],
  controllers: [BirthdayController],
})
export class BirthdayModule {}
