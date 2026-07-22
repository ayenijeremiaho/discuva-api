import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PrayerRequest } from './entity/prayer-request.entity';
import { Testimony } from './entity/testimony.entity';
import { PregnancyPrayerCase } from './entity/pregnancy-prayer-case.entity';
import { PregnancyPrayerVisit } from './entity/pregnancy-prayer-visit.entity';
import { PrayerRequestService } from './service/prayer-request.service';
import { PrayerRequestWorkerController } from './controller/prayer-request-worker.controller';
import { PrayerRequestTeamController } from './controller/prayer-request-team.controller';
import { PrayerRequestAdminController } from './controller/prayer-request-admin.controller';
import { MemberModule } from '../member/member.module';
import { UtilityModule } from '../utility/utility.module';
import { DepartmentModule } from '../department/department.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PrayerRequest,
      Testimony,
      PregnancyPrayerCase,
      PregnancyPrayerVisit,
    ]),
    MemberModule,
    UtilityModule,
    DepartmentModule,
  ],
  providers: [PrayerRequestService],
  controllers: [
    PrayerRequestWorkerController,
    PrayerRequestTeamController,
    PrayerRequestAdminController,
  ],
  exports: [PrayerRequestService],
})
export class PrayerRequestModule {}
