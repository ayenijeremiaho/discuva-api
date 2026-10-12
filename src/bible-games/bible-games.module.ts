import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { Tenant } from '../tenant/entity/tenant.entity';
import { BibleGameProgress } from './entity/bible-game-progress.entity';
import { BibleGameRound } from './entity/bible-game-round.entity';
import { BibleGamePoints } from './entity/bible-game-points.entity';
import { BibleGameBoardMonthly } from './entity/bible-game-board-monthly.entity';
import { BibleGameMonthly } from './entity/bible-game-monthly.entity';
import { BibleGameCustomQuestion } from './entity/bible-game-custom-question.entity';
import { BibleGameHidden } from './entity/bible-game-hidden.entity';
import { BibleCharacterReview } from './entity/bible-character-review.entity';
import { BibleCharacterRound } from './entity/bible-character-round.entity';
import { BibleCharacterDuel } from './entity/bible-character-duel.entity';
import { BibleCharacterDuelService } from './service/bible-character-duel.service';
import { BibleCharacterDuelScheduler } from './scheduler/bible-character-duel.scheduler';
import { BibleCharacterGameService } from './service/bible-character-game.service';
import { BibleCharactersController } from './controller/bible-characters.controller';
import { ChurchSetting } from '../church-settings/entity/church-setting.entity';
import { BibleCharactersService } from './service/bible-characters.service';
import { AdminBibleCharactersController } from './controller/admin-bible-characters.controller';
import { BibleGamesAdminService } from './service/bible-games-admin.service';
import { BibleGamesService } from './service/bible-games.service';
import { BibleGamesController } from './controller/bible-games.controller';
import { AdminBibleGamesController } from './controller/admin-bible-games.controller';
import { ChurchTimezoneService } from '../utility/service/church-timezone.service';

@Module({
  imports: [
    TenantTypeOrmModule.forFeature([
      BibleGameProgress,
      BibleGameRound,
      BibleGamePoints,
      BibleGameMonthly,
      BibleGameBoardMonthly,
      BibleGameCustomQuestion,
      BibleGameHidden,
      BibleCharacterReview,
      BibleCharacterRound,
      BibleCharacterDuel,
      ChurchSetting,
    ]),
    // Tenant is public-schema; ChurchTimezoneService reads its timezone.
    TypeOrmModule.forFeature([Tenant]),
  ],
  providers: [
    BibleGamesService,
    BibleGamesAdminService,
    BibleCharactersService,
    BibleCharacterGameService,
    BibleCharacterDuelService,
    BibleCharacterDuelScheduler,
    ChurchTimezoneService,
  ],
  controllers: [
    BibleGamesController,
    AdminBibleGamesController,
    AdminBibleCharactersController,
    BibleCharactersController,
  ],
})
export class BibleGamesModule {}
