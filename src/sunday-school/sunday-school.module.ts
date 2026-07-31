import { Module } from '@nestjs/common';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { SundaySchoolClass } from './entity/sunday-school-class.entity';
import { SundaySchoolMember } from './entity/sunday-school-member.entity';
import { SundaySchoolSession } from './entity/sunday-school-session.entity';
import { SundaySchoolAttendance } from './entity/sunday-school-attendance.entity';
import { SundaySchoolService } from './service/sunday-school.service';
import { SundaySchoolController } from './controller/sunday-school.controller';
import { SundaySchoolAdminController } from './controller/sunday-school-admin.controller';
import { MemberModule } from '../member/member.module';
import { UtilityModule } from '../utility/utility.module';
import { DepartmentModule } from '../department/department.module';

@Module({
  imports: [
    TenantTypeOrmModule.forFeature([
      SundaySchoolClass,
      SundaySchoolMember,
      SundaySchoolSession,
      SundaySchoolAttendance,
    ]),
    MemberModule,
    UtilityModule,
    DepartmentModule,
  ],
  controllers: [SundaySchoolController, SundaySchoolAdminController],
  providers: [SundaySchoolService],
  exports: [SundaySchoolService],
})
export class SundaySchoolModule {}
