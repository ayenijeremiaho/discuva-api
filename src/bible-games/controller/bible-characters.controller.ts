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
import { BibleCharacterGameService } from '../service/bible-character-game.service';
import { BibleGamesService } from '../service/bible-games.service';
import { BibleCharacterDuelService } from '../service/bible-character-duel.service';
import {
  AskCharacterQuestionDto,
  CharacterScoreboardQueryDto,
  CharadesQueryDto,
  DuelOpponentsQueryDto,
  GuessCharacterDto,
  InviteDuelDto,
  StartCharacterRoundDto,
} from '../dto/bible-game.dto';

// Guess the Bible Character, Solo: menu questions are answered by the server from the character data.
@RequiresModule('bible_characters')
@UseGuards(JwtAuthGuard, ModuleEnabledGuard)
@Controller('bible-characters')
export class BibleCharactersController {
  constructor(
    private readonly game: BibleCharacterGameService,
    private readonly bibleGames: BibleGamesService,
    private readonly duels: BibleCharacterDuelService,
  ) {}

  @Get()
  overview(@Request() req: any) {
    return this.game.overview(req.user.id);
  }

  @Get('scoreboard')
  scoreboard(@Query() query: CharacterScoreboardQueryDto, @Request() req: any) {
    return this.bibleGames.scoreboard(
      req.user.id,
      query.period ?? 'month',
      query.limit ?? 50,
      'characters',
    );
  }

  @Post('rounds')
  start(@Body() dto: StartCharacterRoundDto, @Request() req: any) {
    return this.game.start(req.user.id, dto.difficulty);
  }

  @Get('rounds/:id')
  state(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.game.state(req.user.id, id);
  }

  @Post('rounds/:id/ask')
  ask(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AskCharacterQuestionDto,
    @Request() req: any,
  ) {
    return this.game.ask(req.user.id, id, dto.questionId);
  }

  @Post('rounds/:id/hint')
  hint(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.game.hint(req.user.id, id);
  }

  @Post('rounds/:id/guess')
  guess(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GuessCharacterDto,
    @Request() req: any,
  ) {
    return this.game.guess(req.user.id, id, dto.characterId);
  }

  @Post('rounds/:id/give-up')
  giveUp(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.game.giveUp(req.user.id, id);
  }

  @Get('charades')
  charades(@Query() query: CharadesQueryDto) {
    return this.game.charadesDeck(query.difficulty);
  }

  @Get('duels')
  duelList(@Request() req: any) {
    return this.duels.list(req.user.id);
  }

  @Get('duels/opponents')
  opponents(@Query() query: DuelOpponentsQueryDto, @Request() req: any) {
    return this.duels.opponents(req.user.id, query.search);
  }

  @Post('duels')
  invite(@Body() dto: InviteDuelDto, @Request() req: any) {
    return this.duels.invite(req.user.id, dto.opponentId, dto.difficulty);
  }

  @Get('duels/:id')
  duel(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.duels.get(req.user.id, id);
  }

  @Post('duels/:id/accept')
  accept(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.duels.accept(req.user.id, id);
  }

  @Post('duels/:id/decline')
  decline(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.duels.decline(req.user.id, id);
  }

  @Post('duels/:id/ask')
  duelAsk(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AskCharacterQuestionDto,
    @Request() req: any,
  ) {
    return this.duels.ask(req.user.id, id, dto.questionId);
  }

  @Post('duels/:id/hint')
  duelHint(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.duels.hint(req.user.id, id);
  }

  @Post('duels/:id/guess')
  duelGuess(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GuessCharacterDto,
    @Request() req: any,
  ) {
    return this.duels.guess(req.user.id, id, dto.characterId);
  }

  @Post('duels/:id/resign')
  resign(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.duels.resign(req.user.id, id);
  }
}
