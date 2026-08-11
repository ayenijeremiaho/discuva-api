import { Module } from '@nestjs/common';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { Member } from './entity/member.entity';
import { WorkerProfile } from './entity/worker-profile.entity';
import { Clergy } from './entity/clergy.entity';
import { ClergyTitle } from '../clergy-title/entity/clergy-title.entity';
import { MemberImportJob } from './entity/member-import-job.entity';
import { MemberImportRow } from './entity/member-import-row.entity';
import { MemberSession } from './entity/member-session.entity';
import { MemberService } from './service/member.service';
import { MemberSessionService } from './service/member-session.service';
import { MemberImportService } from './service/member-import.service';
import { MemberController } from './controller/member.controller';
import { MemberImportController } from './controller/member-import.controller';
import { Department } from '../department/entity/department.entity';
import { DepartmentLead } from '../department/entity/department-lead.entity';
import { SundaySchoolClass } from '../sunday-school/entity/sunday-school-class.entity';
import { UtilityModule } from '../utility/utility.module';

@Module({
  imports: [
    TenantTypeOrmModule.forFeature([
      Member,
      WorkerProfile,
      Clergy,
      ClergyTitle,
      MemberImportJob,
      MemberImportRow,
      MemberSession,
      Department,
      DepartmentLead,
      SundaySchoolClass,
    ]),
    UtilityModule,
  ],
  controllers: [MemberController, MemberImportController],
  providers: [MemberService, MemberSessionService, MemberImportService],
  exports: [MemberService, MemberSessionService, TenantTypeOrmModule],
})
export class MemberModule {}
