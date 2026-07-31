import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { Public } from '../../auth/decorator/public.decorator';
import { CurrentUser } from '../../auth/decorator/current-user.decorator';
import { MemberAuth } from '../../auth/interface/auth.interface';
import { RequiresModule } from '../../church-settings/decorator/requires-module.decorator';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';
import { GameService } from '../service/game.service';
import { GameSessionGateway } from '../gateway/game-session.gateway';
import { SubmitAnswerDto } from '../dto/game.dto';

// Open to any authenticated member/worker with the join code — no
// department/class access-control check by product decision. A game's
// department/churchClass are for admin-side categorization/reporting only.
@RequiresModule('games')
@UseGuards(JwtAuthGuard, ModuleEnabledGuard)
@Controller('games')
export class GameParticipantController {
  constructor(
    private readonly gameService: GameService,
    private readonly gateway: GameSessionGateway,
  ) {}

  @Post('sessions/:code/join')
  async join(@Param('code') code: string, @CurrentUser() user: MemberAuth) {
    const result = await this.gameService.joinSession(code, user.id);
    const state = await this.gameService.getSessionState(code);
    this.gateway.broadcastState(code, state);
    return result;
  }

  // Public so the projector/screen presentation view (opened on a second
  // laptop with just the join code, no login) can poll and render it —
  // mirrors ServiceSessionController's public :sessionCode/state route.
  // Never leaks correctOptionIndex (see getSessionState's own comment).
  @Get('sessions/:code/state')
  @Public()
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  getState(@Param('code') code: string) {
    return this.gameService.getSessionState(code);
  }

  @Post('sessions/:code/questions/:questionId/answer')
  async answer(
    @Param('code') code: string,
    @Param('questionId') questionId: string,
    @Body() dto: SubmitAnswerDto,
    @CurrentUser() user: MemberAuth,
  ) {
    const result = await this.gameService.submitAnswer(
      code,
      questionId,
      user.id,
      dto,
    );
    const state = await this.gameService.getSessionState(code);
    this.gateway.broadcastState(code, state);
    return result;
  }

  @Get('sessions/:code/leaderboard')
  getLeaderboard(@Param('code') code: string) {
    return this.gameService.getLeaderboard(code);
  }
}
