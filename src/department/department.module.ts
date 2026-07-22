import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
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
    TypeOrmModule.forFeature([
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
  exports: [TypeOrmModule, DepartmentService, DepartmentAccessService],
})
export class DepartmentModule {}
