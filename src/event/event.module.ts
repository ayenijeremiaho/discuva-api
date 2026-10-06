import { Group } from '../group/entity/group.entity';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
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
import { MemberModule } from '../member/member.module';
import { AnnouncementModule } from '../announcement/announcement.module';
import { Tenant } from '../tenant/entity/tenant.entity';

import { EventSeries } from './entity/event-series.entity';
import { EventTemplate } from './entity/event-template.entity';
import { EventSeriesService } from './service/event-series.service';
import { EventTemplateService } from './service/event-template.service';
import { ChurchTimezoneService } from './service/church-timezone.service';
import { EventSeriesScheduler } from './scheduler/event-series.scheduler';
import {
  EventSeriesController,
  EventTemplateController,
  EventAudienceController,
} from './controller/event-series.controller';
import { ServiceProgrammeModule } from '../service-programme/service-programme.module';

@Module({
  imports: [
    TenantTypeOrmModule.forFeature([
      Event,
      EventConfig,
      ServiceSlot,
      EventReminder,
      EventSeries,
      EventTemplate,
      Group,
    ]),
    // Tenant is public-schema, control-plane — plain TypeOrmModule, needed
    // by EventReminderService.dispatchDueReminders' forEachActiveTenant loop.
    TypeOrmModule.forFeature([Tenant]),
    UtilityModule,
    VenueModule,
    MemberModule,
    AnnouncementModule,
    ServiceProgrammeModule,
  ],
  // Series/template controllers first so `events/series` isn't matched as `events/:id`.
  controllers: [
    EventAudienceController,
    EventSeriesController,
    EventTemplateController,
    EventController,
    EventConfigController,
    EventReminderController,
  ],
  providers: [
    EventService,
    EventConfigService,
    EventReminderService,
    EventSeriesService,
    EventTemplateService,
    ChurchTimezoneService,
    EventSeriesScheduler,
  ],
  exports: [TenantTypeOrmModule, EventService, EventConfigService],
})
export class EventModule {}
