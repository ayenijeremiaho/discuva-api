import { Module } from '@nestjs/common';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { RotaAssignment } from './entity/rota-assignment.entity';
import { RotaCoverRequest } from './entity/rota-cover-request.entity';
import { ServingRotaService } from './service/serving-rota.service';
import { ServingRotaController } from './controller/serving-rota.controller';
import { RotaReminderScheduler } from './scheduler/rota-reminder.scheduler';
import { RotaSetupService } from './service/rota-setup.service';
import { RotaSubteam } from './entity/rota-subteam.entity';
import { RotaResponsibility } from './entity/rota-responsibility.entity';
import { RotaResponsibilityMember } from './entity/rota-responsibility-member.entity';
import { RotaPlannerGrant } from './entity/rota-planner-grant.entity';
import { RotaSchedule } from './entity/rota-schedule.entity';
import { RotaUnavailability } from './entity/rota-unavailability.entity';
import { RotaAllocationService } from './service/rota-allocation.service';
import { RotaCustomAssignment } from './entity/rota-custom-assignment.entity';
import { RotaCustomService } from './service/rota-custom.service';

@Module({
  imports: [
    TenantTypeOrmModule.forFeature([
      RotaAssignment,
      RotaCoverRequest,
      RotaSubteam,
      RotaResponsibility,
      RotaResponsibilityMember,
      RotaPlannerGrant,
      RotaSchedule,
      RotaUnavailability,
      RotaCustomAssignment,
    ]),
  ],
  providers: [
    ServingRotaService,
    RotaSetupService,
    RotaAllocationService,
    RotaCustomService,
    RotaReminderScheduler,
  ],
  controllers: [ServingRotaController],
})
export class ServingRotaModule {}
