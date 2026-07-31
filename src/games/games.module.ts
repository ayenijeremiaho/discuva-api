import { Module } from '@nestjs/common';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { Game } from './entity/game.entity';
import { GameQuestion } from './entity/game-question.entity';
import { GameSession } from './entity/game-session.entity';
import { GameParticipant } from './entity/game-participant.entity';
import { GameResponse } from './entity/game-response.entity';
import { GameService } from './service/game.service';
import { GameSessionGateway } from './gateway/game-session.gateway';
import { AdminGameController } from './controller/admin-game.controller';
import { GameParticipantController } from './controller/game-participant.controller';
import { UtilityModule } from '../utility/utility.module';

@Module({
  imports: [
    TenantTypeOrmModule.forFeature([
      Game,
      GameQuestion,
      GameSession,
      GameParticipant,
      GameResponse,
    ]),
    UtilityModule,
  ],
  providers: [GameService, GameSessionGateway],
  controllers: [AdminGameController, GameParticipantController],
})
export class GamesModule {}
