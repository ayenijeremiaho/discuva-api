import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { Tenant } from '../tenant/entity/tenant.entity';
import { BibleGameProgress } from './entity/bible-game-progress.entity';
import { BibleGameRound } from './entity/bible-game-round.entity';
import { BibleGamePoints } from './entity/bible-game-points.entity';
import { BibleGameMonthly } from './entity/bible-game-monthly.entity';
import { BibleGameCustomQuestion } from './entity/bible-game-custom-question.entity';
import { BibleGameHidden } from './entity/bible-game-hidden.entity';
import { BibleGamesAdminService } from './service/bible-games-admin.service';
import { BibleGamesService } from './service/bible-games.service';
import { BibleGamesController } from './controller/bible-games.controller';
import { AdminBibleGamesController } from './controller/admin-bible-games.controller';
import { ChurchTimezoneService } from '../event/service/church-timezone.service';

@Module({
  imports: [
    TenantTypeOrmModule.forFeature([
      BibleGameProgress,
      BibleGameRound,
      BibleGamePoints,
      BibleGameMonthly,
      BibleGameCustomQuestion,
      BibleGameHidden,
    ]),
    // Tenant is public-schema; ChurchTimezoneService reads its timezone.
    TypeOrmModule.forFeature([Tenant]),
  ],
  providers: [BibleGamesService, BibleGamesAdminService, ChurchTimezoneService],
  controllers: [BibleGamesController, AdminBibleGamesController],
})
export class BibleGamesModule {}
