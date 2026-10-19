import { Module } from '@nestjs/common';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { RotaAssignment } from './entity/rota-assignment.entity';
import { RotaCoverRequest } from './entity/rota-cover-request.entity';
import { ServingRotaService } from './service/serving-rota.service';
import { ServingRotaController } from './controller/serving-rota.controller';
import { RotaReminderScheduler } from './scheduler/rota-reminder.scheduler';

@Module({
  imports: [TenantTypeOrmModule.forFeature([RotaAssignment, RotaCoverRequest])],
  providers: [ServingRotaService, RotaReminderScheduler],
  controllers: [ServingRotaController],
})
export class ServingRotaModule {}
