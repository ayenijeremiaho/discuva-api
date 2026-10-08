import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { RequiresModule } from '../../church-settings/decorator/requires-module.decorator';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';
import { BibleGamesService } from '../service/bible-games.service';
import {
  AnswerDto,
  ScoreboardQueryDto,
  StartRoundDto,
} from '../dto/bible-game.dto';

@RequiresModule('bible_games')
@UseGuards(JwtAuthGuard, ModuleEnabledGuard)
@Controller('bible-games')
export class BibleGamesController {
  constructor(private readonly bibleGames: BibleGamesService) {}

  @Get()
  overview(@Request() req: any) {
    return this.bibleGames.overview(req.user.id);
  }

  @Get('scoreboard')
  scoreboard(@Query() query: ScoreboardQueryDto, @Request() req: any) {
    return this.bibleGames.scoreboard(
      req.user.id,
      query.period ?? 'month',
      query.limit ?? 50,
    );
  }

  @Post('rounds')
  start(@Body() dto: StartRoundDto, @Request() req: any) {
    return this.bibleGames.start(req.user.id, dto);
  }

  @Post('rounds/:id/answer')
  answer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AnswerDto,
    @Request() req: any,
  ) {
    return this.bibleGames.answer(req.user.id, id, dto);
  }

  @Post('rounds/:id/next')
  next(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.bibleGames.next(req.user.id, id);
  }
}
