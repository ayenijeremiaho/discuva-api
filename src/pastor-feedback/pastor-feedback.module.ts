import { Module } from '@nestjs/common';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { PastorFeedback } from './entity/pastor-feedback.entity';
import { PastorFeedbackService } from './service/pastor-feedback.service';
import { PastorFeedbackReminderScheduler } from './scheduler/pastor-feedback-reminder.scheduler';
import { PastorFeedbackWorkerController } from './controller/pastor-feedback-worker.controller';
import { PastorFeedbackAdminController } from './controller/pastor-feedback-admin.controller';
import { PastorFeedbackPastorController } from './controller/pastor-feedback-pastor.controller';
import { MemberModule } from '../member/member.module';
import { DepartmentModule } from '../department/department.module';
import { UtilityModule } from '../utility/utility.module';
import { PushNotificationModule } from '../push-notification/push-notification.module';

@Module({
  imports: [
    TenantTypeOrmModule.forFeature([PastorFeedback]),
    MemberModule,
    DepartmentModule,
    UtilityModule,
    PushNotificationModule,
  ],
  providers: [PastorFeedbackService, PastorFeedbackReminderScheduler],
  controllers: [
    PastorFeedbackWorkerController,
    PastorFeedbackAdminController,
    PastorFeedbackPastorController,
  ],
  exports: [PastorFeedbackService],
})
export class PastorFeedbackModule {}
