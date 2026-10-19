import { Module } from '@nestjs/common';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { TeamPulse } from './entity/team-pulse.entity';
import { TeamPulseRound } from './entity/team-pulse-round.entity';
import { TeamPulseParticipation } from './entity/team-pulse-participation.entity';
import { Department } from '../department/entity/department.entity';
import { DepartmentLead } from '../department/entity/department-lead.entity';
import { WorkerProfile } from '../member/entity/worker-profile.entity';
import { Clergy } from '../member/entity/clergy.entity';
import { TeamPulseService } from './service/team-pulse.service';
import { TeamPulseController } from './controller/team-pulse.controller';
import { TeamPulseScheduler } from './scheduler/team-pulse.scheduler';

@Module({
  imports: [
    TenantTypeOrmModule.forFeature([
      TeamPulse,
      TeamPulseRound,
      TeamPulseParticipation,
      Department,
      DepartmentLead,
      WorkerProfile,
      Clergy,
    ]),
  ],
  providers: [TeamPulseService, TeamPulseScheduler],
  controllers: [TeamPulseController],
})
export class TeamPulseModule {}
