import { Module } from '@nestjs/common';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { Convert } from './entity/convert.entity';
import { ConvertFollowUpLog } from './entity/convert-follow-up-log.entity';
import { Outreach } from './entity/outreach.entity';
import { WorkerProfile } from '../member/entity/worker-profile.entity';
import { Member } from '../member/entity/member.entity';
import { ChurchSetting } from '../church-settings/entity/church-setting.entity';
import { FirstTimer } from '../follow-up/entity/first-timer.entity';
import { ConvertService } from './service/convert.service';
import { OutreachService } from './service/outreach.service';
import { EvangelismSettingsService } from './service/evangelism-settings.service';
import { EvangelismReportService } from './service/evangelism-report.service';
import { ConvertWorkerController } from './controller/convert-worker.controller';
import { ConvertTeamController } from './controller/convert-team.controller';
import { ConvertAdminController } from './controller/convert-admin.controller';
import { MemberModule } from '../member/member.module';
import { UtilityModule } from '../utility/utility.module';
import { DepartmentModule } from '../department/department.module';

@Module({
  imports: [
    TenantTypeOrmModule.forFeature([
      Convert,
      ConvertFollowUpLog,
      Outreach,
      WorkerProfile,
      Member,
      ChurchSetting,
      FirstTimer,
    ]),
    MemberModule,
    UtilityModule,
    DepartmentModule,
  ],
  providers: [
    ConvertService,
    OutreachService,
    EvangelismSettingsService,
    EvangelismReportService,
  ],
  controllers: [
    ConvertWorkerController,
    ConvertTeamController,
    ConvertAdminController,
  ],
  exports: [ConvertService],
})
export class EvangelismModule {}
