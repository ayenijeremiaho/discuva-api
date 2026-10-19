import { Module } from '@nestjs/common';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { PrayerRosterEntry } from '../prayer/entity/prayer-roster-entry.entity';
import { SmallGroup } from '../small-group/entity/small-group.entity';
import { ClassSession } from '../classes/entity/class-session.entity';
import { MyWeekService } from './service/my-week.service';
import { MyWeekController } from './controller/my-week.controller';
import { TeamSpaceModule } from '../team-space/team-space.module';

@Module({
  imports: [
    TenantTypeOrmModule.forFeature([
      PrayerRosterEntry,
      SmallGroup,
      ClassSession,
    ]),
    TeamSpaceModule,
  ],
  providers: [MyWeekService],
  controllers: [MyWeekController],
})
export class MyWeekModule {}
