import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { ChildAgeGroup } from './entity/child-age-group.entity';
import { ChildClassGroup } from './entity/child-class-group.entity';
import { ChildProfile } from './entity/child-profile.entity';
import { ChildGuardian } from './entity/child-guardian.entity';
import { ChildCheckIn } from './entity/child-check-in.entity';
import { ChildCheckInNote } from './entity/child-checkin-note.entity';
import { ServiceSlot } from '../event/entity/service-slot.entity';
import { DepartmentLead } from '../department/entity/department-lead.entity';
import { ChildrenChurchService } from './service/children-church.service';
import { ChildCareService } from './service/child-care.service';
import { ChildCheckInNoteService } from './service/child-checkin-note.service';
import { ChildrenChurchDashboardService } from './service/children-church-dashboard.service';
import { ChildrenChurchAdminService } from './service/children-church-admin.service';
import { LatePickupProcessor } from './processor/late-pickup.processor';
import { ChildrenChurchCareController } from './controller/children-church-care.controller';
import { ChildrenChurchController } from './controller/children-church.controller';
import { MemberModule } from '../member/member.module';
import { EventModule } from '../event/event.module';
import { UtilityModule } from '../utility/utility.module';
import { DepartmentModule } from '../department/department.module';
import { PushNotificationModule } from '../push-notification/push-notification.module';
import { CHILDREN_LATE_QUEUE } from './children-church.constants';

@Module({
  imports: [
    TenantTypeOrmModule.forFeature([
      ChildAgeGroup,
      ChildClassGroup,
      ChildProfile,
      ChildGuardian,
      ChildCheckIn,
      ChildCheckInNote,
      ServiceSlot,
      DepartmentLead,
    ]),
    BullModule.registerQueue({ name: CHILDREN_LATE_QUEUE }),
    MemberModule,
    EventModule,
    UtilityModule,
    DepartmentModule,
    PushNotificationModule,
  ],
  controllers: [ChildrenChurchCareController, ChildrenChurchController],
  providers: [
    ChildrenChurchService,
    ChildCareService,
    ChildCheckInNoteService,
    ChildrenChurchDashboardService,
    ChildrenChurchAdminService,
    LatePickupProcessor,
  ],
  exports: [ChildrenChurchService],
})
export class ChildrenChurchModule {}
