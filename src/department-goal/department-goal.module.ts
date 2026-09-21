import { Module } from '@nestjs/common';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { DepartmentGoalCycle } from './entity/department-goal-cycle.entity';
import { DepartmentGoal } from './entity/department-goal.entity';
import { DepartmentGoalApproval } from './entity/department-goal-approval.entity';
import { DepartmentGoalComment } from './entity/department-goal-comment.entity';
import { DepartmentGoalImportJob } from './entity/department-goal-import-job.entity';
import { DepartmentGoalImportRow } from './entity/department-goal-import-row.entity';
import { DepartmentGoalService } from './service/department-goal.service';
import { DepartmentGoalApprovalService } from './service/department-goal-approval.service';
import { DepartmentGoalImportService } from './service/department-goal-import.service';
import { DepartmentGoalAdminController } from './controller/department-goal-admin.controller';
import { DepartmentGoalMemberController } from './controller/department-goal-member.controller';
import { DepartmentGoalImportController } from './controller/department-goal-import.controller';
import { DepartmentModule } from '../department/department.module';
import { UtilityModule } from '../utility/utility.module';
import { AdminModule } from '../admin/admin.module';

@Module({
  imports: [
    TenantTypeOrmModule.forFeature([
      DepartmentGoalCycle,
      DepartmentGoal,
      DepartmentGoalApproval,
      DepartmentGoalComment,
      DepartmentGoalImportJob,
      DepartmentGoalImportRow,
    ]),
    // Brings in DepartmentService (assertIsDepartmentLead/getLeadRoles), the
    // Department repository (used directly by DepartmentGoalImportService),
    // and the WorkerProfile repository — same cross-module import shape
    // follow-up/evangelism/attendance already use, not Games (which has no
    // cross-module service dependency and is a poor precedent here).
    DepartmentModule,
    UtilityModule,
    AdminModule,
  ],
  providers: [
    DepartmentGoalService,
    DepartmentGoalApprovalService,
    DepartmentGoalImportService,
  ],
  controllers: [
    DepartmentGoalAdminController,
    DepartmentGoalMemberController,
    DepartmentGoalImportController,
  ],
})
export class DepartmentGoalModule {}
