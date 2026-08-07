import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { Tenant } from '../tenant/entity/tenant.entity';
import { PrayerProgram } from './entity/prayer-program.entity';
import { PrayerScheduleConfig } from './entity/prayer-schedule-config.entity';
import { PrayerDayConfig } from './entity/prayer-day-config.entity';
import { PrayerScheduleRule } from './entity/prayer-schedule-rule.entity';
import { PrayerFixedAssignment } from './entity/prayer-fixed-assignment.entity';
import { PrayerMeeting } from './entity/prayer-meeting.entity';
import { PrayerRosterEntry } from './entity/prayer-roster-entry.entity';
import { WorkerProfile } from '../member/entity/worker-profile.entity';
import { Member } from '../member/entity/member.entity';
import { DepartmentLead } from '../department/entity/department-lead.entity';
import { PrayerConfigService } from './service/prayer-config.service';
import { PrayerMeetingService } from './service/prayer-meeting.service';
import { PrayerRosterService } from './service/prayer-roster.service';
import { PrayerReminderScheduler } from './scheduler/prayer-reminder.scheduler';
import { PrayerAdminController } from './controller/prayer-admin.controller';
import { PrayerWorkerController } from './controller/prayer-worker.controller';
import { UtilityModule } from '../utility/utility.module';
import { AdminModule } from '../admin/admin.module';

@Module({
  imports: [
    TenantTypeOrmModule.forFeature([
      PrayerProgram,
      PrayerScheduleConfig,
      PrayerDayConfig,
      PrayerScheduleRule,
      PrayerFixedAssignment,
      PrayerMeeting,
      PrayerRosterEntry,
      WorkerProfile,
      Member,
      DepartmentLead,
    ]),
    // Tenant is public-schema, control-plane — plain TypeOrmModule, needed
    // by PrayerReminderScheduler's forEachActiveTenant loop.
    TypeOrmModule.forFeature([Tenant]),
    UtilityModule,
    AdminModule,
  ],
  providers: [
    PrayerConfigService,
    PrayerMeetingService,
    PrayerRosterService,
    PrayerReminderScheduler,
  ],
  controllers: [PrayerAdminController, PrayerWorkerController],
})
export class PrayerModule {}
