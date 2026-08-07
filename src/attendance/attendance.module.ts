import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { BullModule } from '@nestjs/bull';
import { Attendance } from './entity/attendance.entity';
import { AttendanceService } from './service/attendance.service';
import { AttendanceController } from './controller/attendance.controller';
import { AttendanceJobService } from './job/attendance-job';
import { ServiceSlot } from '../event/entity/service-slot.entity';
import { Tenant } from '../tenant/entity/tenant.entity';
import { MemberModule } from '../member/member.module';
import { EventModule } from '../event/event.module';
import { DepartmentModule } from '../department/department.module';
import { UtilityModule } from '../utility/utility.module';
import { FOLLOW_UP_QUEUE } from '../follow-up/processor/post-event.processor';

@Module({
  imports: [
    TenantTypeOrmModule.forFeature([Attendance, ServiceSlot]),
    // Tenant is public-schema, control-plane — plain TypeOrmModule, needed
    // by AttendanceJobService's forEachActiveTenant loop.
    TypeOrmModule.forFeature([Tenant]),
    BullModule.registerQueue({ name: FOLLOW_UP_QUEUE }),
    MemberModule,
    EventModule,
    DepartmentModule,
    UtilityModule,
  ],
  controllers: [AttendanceController],
  providers: [AttendanceService, AttendanceJobService],
  exports: [TenantTypeOrmModule, AttendanceService],
})
export class AttendanceModule {}
