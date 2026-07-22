import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Convert } from './entity/convert.entity';
import { ConvertFollowUpLog } from './entity/convert-follow-up-log.entity';
import { WorkerProfile } from '../member/entity/worker-profile.entity';
import { ConvertService } from './service/convert.service';
import { ConvertWorkerController } from './controller/convert-worker.controller';
import { ConvertTeamController } from './controller/convert-team.controller';
import { ConvertAdminController } from './controller/convert-admin.controller';
import { MemberModule } from '../member/member.module';
import { UtilityModule } from '../utility/utility.module';
import { DepartmentModule } from '../department/department.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Convert, ConvertFollowUpLog, WorkerProfile]),
    MemberModule,
    UtilityModule,
    DepartmentModule,
  ],
  providers: [ConvertService],
  controllers: [
    ConvertWorkerController,
    ConvertTeamController,
    ConvertAdminController,
  ],
  exports: [ConvertService],
})
export class EvangelismModule {}
