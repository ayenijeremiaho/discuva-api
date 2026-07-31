import { Module } from '@nestjs/common';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { Event } from './entity/event.entity';
import { EventConfig } from './entity/event-config.entity';
import { ServiceSlot } from './entity/service-slot.entity';
import { EventReminder } from './entity/event-reminder.entity';
import { EventService } from './service/event.service';
import { EventConfigService } from './service/event-config.service';
import { EventReminderService } from './service/event-reminder.service';
import { EventController } from './controller/event.controller';
import { EventConfigController } from './controller/event-config.controller';
import { EventReminderController } from './controller/event-reminder.controller';
import { UtilityModule } from '../utility/utility.module';
import { VenueModule } from '../venue/venue.module';
import { DefaultEventConfigSeed } from './seed/default-event-config-seed.service';
import { MemberModule } from '../member/member.module';
import { AnnouncementModule } from '../announcement/announcement.module';

@Module({
  imports: [
    TenantTypeOrmModule.forFeature([
      Event,
      EventConfig,
      ServiceSlot,
      EventReminder,
    ]),
    UtilityModule,
    VenueModule,
    MemberModule,
    AnnouncementModule,
  ],
  controllers: [
    EventController,
    EventConfigController,
    EventReminderController,
  ],
  providers: [
    EventService,
    EventConfigService,
    DefaultEventConfigSeed,
    EventReminderService,
  ],
  exports: [TenantTypeOrmModule, EventService, EventConfigService],
})
export class EventModule {}
