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
    TenantTypeOrmModule.forFeature([ChurchCalendar]),
    UtilityModule,
    AdminModule,
  ],
  providers: [ChurchCalendarService],
  controllers: [ChurchCalendarAdminController, ChurchCalendarMemberController],
})
export class ChurchCalendarModule {}
