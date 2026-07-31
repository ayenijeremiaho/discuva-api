import { Module } from '@nestjs/common';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { Department } from './entity/department.entity';
import { DepartmentLead } from './entity/department-lead.entity';
import { DepartmentService } from './service/department.service';
import { DepartmentAccessService } from './service/department-access.service';
import { DepartmentController } from './controller/department.controller';
import { WorkerProfile } from '../member/entity/worker-profile.entity';
import { RequestLeave } from '../request-leave/enitity/request-leave.entity';
import { Attendance } from '../attendance/entity/attendance.entity';
import { UtilityModule } from '../utility/utility.module';

@Module({
  imports: [
    TenantTypeOrmModule.forFeature([
      Department,
      DepartmentLead,
      WorkerProfile,
      RequestLeave,
      Attendance,
    ]),
    UtilityModule,
  ],
  controllers: [DepartmentController],
  providers: [DepartmentService, DepartmentAccessService],
  exports: [TenantTypeOrmModule, DepartmentService, DepartmentAccessService],
})
export class DepartmentModule {}
