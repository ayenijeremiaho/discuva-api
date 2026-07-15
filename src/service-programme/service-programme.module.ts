import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServiceProgramme } from './entity/service-programme.entity';
import { ServiceProgrammeSlot } from './entity/service-programme-slot.entity';
import { ServiceSession } from './entity/service-session.entity';
import { ServiceSessionSlot } from './entity/service-session-slot.entity';
import { ServicePauseEntry } from './entity/service-pause-entry.entity';
import { ServiceActionEntry } from './entity/service-action-entry.entity';
import { ServiceSessionAccessGrant } from './entity/service-session-access-grant.entity';
import { ServiceProgrammeTemplate } from './entity/service-programme-template.entity';
import { ServiceSlot } from '../event/entity/service-slot.entity';
import { Member } from '../member/entity/member.entity';
import { WorkerProfile } from '../member/entity/worker-profile.entity';
import { ServiceProgrammeService } from './service/service-programme.service';
import { ServiceSessionService } from './service/service-session.service';
import { ServiceProgrammeController } from './controller/service-programme.controller';
import { ServiceSessionController } from './controller/service-session.controller';
import { ServiceSessionGateway } from './gateway/service-session.gateway';
import { ShareTokenGuard } from './guard/share-token.guard';
import { NamedAccessGuard } from './guard/named-access.guard';
import { ServiceProgrammeReminderScheduler } from './scheduler/service-programme-reminder.scheduler';
import { UtilityModule } from '../utility/utility.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ServiceProgramme,
      ServiceProgrammeSlot,
      ServiceSession,
      ServiceSessionSlot,
      ServicePauseEntry,
      ServiceActionEntry,
      ServiceSessionAccessGrant,
      ServiceProgrammeTemplate,
      ServiceSlot,
      Member,
      WorkerProfile,
    ]),
    UtilityModule,
  ],
  controllers: [ServiceProgrammeController, ServiceSessionController],
  providers: [
    ServiceProgrammeService,
    ServiceSessionService,
    ServiceSessionGateway,
    ShareTokenGuard,
    NamedAccessGuard,
    ServiceProgrammeReminderScheduler,
  ],
  exports: [ServiceProgrammeService, ServiceSessionService],
})
export class ServiceProgrammeModule {}
