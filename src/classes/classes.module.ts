import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { ChurchClass } from './entity/church-class.entity';
import { ClassEnrollment } from './entity/class-enrollment.entity';
import { ClassType } from './entity/class-type.entity';
import { Assignment } from './entity/assignment.entity';
import { AssignmentSubmission } from './entity/assignment-submission.entity';
import { Guest } from './entity/guest.entity';
import { ClassMaterial } from './entity/class-material.entity';
import { ClassFacilitator } from './entity/class-facilitator.entity';
import { ClassSession } from './entity/class-session.entity';
import { ClassSessionAttendance } from './entity/class-session-attendance.entity';
import { ClassJoinRequest } from './entity/class-join-request.entity';
import { ClassSessionService } from './service/class-session.service';
import { ClassProgressService } from './service/class-progress.service';
import { ClassFacilitatorAccessService } from './service/class-facilitator-access.service';
import { ClassJoinRequestService } from './service/class-join-request.service';
import { ClassCertificateService } from './service/class-certificate.service';
import { ClassReportService } from './service/class-report.service';
import { ClassTrainingController } from './controller/class-training.controller';
import { ClassesService } from './service/classes.service';
import { ClassTypesService } from './service/class-types.service';
import { AssignmentService } from './service/assignment.service';
import { GuestService } from './service/guest.service';
import { ClassesController } from './controller/classes.controller';
import { ClassTypesController } from './controller/class-types.controller';
import { AssignmentController } from './controller/assignment.controller';
import { ClassPublicController } from './controller/class-public.controller';
import { MemberModule } from '../member/member.module';
import { UtilityModule } from '../utility/utility.module';
import { SmsModule } from '../sms/sms.module';
import { Tenant } from '../tenant/entity/tenant.entity';
import { AssignmentReminderScheduler } from './scheduler/assignment-reminder.scheduler';
import { ClassSessionReminderScheduler } from './scheduler/class-session-reminder.scheduler';

@Module({
  imports: [
    TenantTypeOrmModule.forFeature([
      ChurchClass,
      ClassEnrollment,
      ClassType,
      Assignment,
      AssignmentSubmission,
      Guest,
      ClassMaterial,
      ClassFacilitator,
      ClassSession,
      ClassSessionAttendance,
      ClassJoinRequest,
    ]),
    // Tenant is public-schema, control-plane — plain TypeOrmModule, needed
    // by the two class schedulers' forEachActiveTenant loops.
    TypeOrmModule.forFeature([Tenant]),
    MemberModule,
    UtilityModule,
    SmsModule,
  ],
  providers: [
    ClassesService,
    ClassTypesService,
    AssignmentService,
    GuestService,
    ClassSessionService,
    ClassProgressService,
    ClassFacilitatorAccessService,
    ClassJoinRequestService,
    ClassCertificateService,
    ClassReportService,
    AssignmentReminderScheduler,
    ClassSessionReminderScheduler,
  ],
  // ClassTypesController must be registered before ClassesController — Nest
  // registers routes in this array's order, and ClassesController's
  // GET /classes/:id would otherwise swallow GET /classes/types (matching
  // "types" as :id) since both are checked as plain 2-segment paths.
  controllers: [
    ClassTypesController,
    ClassTrainingController,
    ClassesController,
    AssignmentController,
    ClassPublicController,
  ],
  exports: [TenantTypeOrmModule, ClassesService, ClassTypesService],
})
export class ClassesModule {}
