import { TypeOrmModule } from '@nestjs/typeorm';
import { Event } from '../event/entity/event.entity';
import { Tenant } from '../tenant/entity/tenant.entity';
import { ChurchTimezoneService } from '../event/service/church-timezone.service';
import { Module } from '@nestjs/common';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { ChurchCalendar } from './entity/church-calendar.entity';
import { ChurchCalendarService } from './service/church-calendar.service';
import { ChurchCalendarAdminController } from './controller/church-calendar-admin.controller';
import { ChurchCalendarMemberController } from './controller/church-calendar-member.controller';
import { UtilityModule } from '../utility/utility.module';
import { AdminModule } from '../admin/admin.module';

@Module({
  imports: [
    TenantTypeOrmModule.forFeature([ChurchCalendar, Event]),
    // Tenant is public-schema; ChurchTimezoneService reads its timezone.
    TypeOrmModule.forFeature([Tenant]),
    UtilityModule,
    AdminModule,
  ],
  providers: [ChurchCalendarService, ChurchTimezoneService],
  controllers: [ChurchCalendarAdminController, ChurchCalendarMemberController],
  // Exported so PagesModule can inject ChurchCalendarService directly for
  // the CHURCH_CALENDAR section type (reuses the real lookup rather than
  // duplicating a repo query) — see PageService.withChurchCalendarEntries.
  exports: [ChurchCalendarService],
})
export class ChurchCalendarModule {}
