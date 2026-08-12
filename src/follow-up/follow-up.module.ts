import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { BullModule } from '@nestjs/bull';
import { ConfigModule } from '@nestjs/config';
import { FirstTimer } from './entity/first-timer.entity';
import { FirstTimerVisit } from './entity/first-timer-visit.entity';
import { FollowUpTask } from './entity/follow-up-task.entity';
import { FollowUpNote } from './entity/follow-up-note.entity';
import { WorkerProfile } from '../member/entity/worker-profile.entity';
import { Event } from '../event/entity/event.entity';
import { Attendance } from '../attendance/entity/attendance.entity';
import { Admin } from '../admin/entity/admin.entity';
import { AdminRole } from '../admin/entity/admin-role.entity';
import { FollowUpService } from './service/follow-up.service';
import { FollowUpController } from './controller/follow-up.controller';
import { FollowUpAdminController } from './controller/follow-up-admin.controller';
import {
  FOLLOW_UP_QUEUE,
  PostEventProcessor,
} from './processor/post-event.processor';
import { FollowUpScheduler } from './scheduler/follow-up.scheduler';
import { UtilityModule } from '../utility/utility.module';
import { DepartmentModule } from '../department/department.module';
import { Tenant } from '../tenant/entity/tenant.entity';

@Module({
  imports: [
    ConfigModule,
    TenantTypeOrmModule.forFeature([
      FirstTimer,
      FirstTimerVisit,
      FollowUpTask,
      FollowUpNote,
      WorkerProfile,
      Event,
      Attendance,
      Admin,
      AdminRole,
    ]),
    // Tenant is public-schema, control-plane — plain TypeOrmModule, needed
    // by FollowUpScheduler's forEachActiveTenant loops.
    TypeOrmModule.forFeature([Tenant]),
    BullModule.registerQueue({
      name: FOLLOW_UP_QUEUE,
      settings: {
        lockDuration: 5 * 60 * 1000,
        maxStalledCount: 2,
        // A per-queue `settings` object here fully replaces (not merges
        // with) BullModule.forRootAsync's own `settings` — see the comment
        // there. Repeated to match the root config rather than falling
        // back to Bull's noisy 5s/5s/30s defaults; post-event follow-up
        // work isn't time-critical enough to justify faster stalled-job
        // detection than the app's other queues get.
        drainDelay: 3600,
        guardInterval: 3600000,
        stalledInterval: 600000,
      },
    }),
    UtilityModule,
    DepartmentModule,
  ],
  controllers: [FollowUpController, FollowUpAdminController],
  providers: [FollowUpService, PostEventProcessor, FollowUpScheduler],
  exports: [FollowUpService],
})
export class FollowUpModule {}
