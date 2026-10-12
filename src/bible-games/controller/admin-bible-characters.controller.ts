import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { CurrentAdmin } from '../../admin/decorator/current-admin.decorator';
import { Admin } from '../../admin/entity/admin.entity';
import { RequiresModule } from '../../church-settings/decorator/requires-module.decorator';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';
import { BibleCharactersService } from '../service/bible-characters.service';
import { BibleCharacterGameService } from '../service/bible-character-game.service';
import { BibleGamesService } from '../service/bible-games.service';
import { BibleCharacterDuelService } from '../service/bible-character-duel.service';
import {
  BibleCharacterSettingsDto,
  CharacterScoreboardQueryDto,
  UpdateBibleCharacterDto,
} from '../dto/bible-game.dto';
import { CharacterIdPipe } from '../pipe/character-id.pipe';

// Church review of the "Guess the Bible Character" list: anyone with Manage Games can review, hide or adjust.
@RequiresModule('bible_characters')
@UseGuards(AdminGuard, ModuleEnabledGuard)
@Controller('admin/bible-games/characters')
export class AdminBibleCharactersController {
  constructor(
    private readonly characters: BibleCharactersService,
    private readonly game: BibleCharacterGameService,
    private readonly bibleGames: BibleGamesService,
    private readonly duels: BibleCharacterDuelService,
  ) {}

  @Get()
  @RequiresPermission(AdminPermission.GAMES_READ)
  list() {
    return this.characters.adminList();
  }

  @Get('stats')
  @RequiresPermission(AdminPermission.GAMES_READ)
  async stats() {
    const [solo, duels, settings] = await Promise.all([
      this.game.adminStats(),
      this.duels.adminStats(),
      this.characters.settings(),
    ]);
    return { ...solo, duels: { ...duels, turnHours: settings.turnHours } };
  }

  @Get('scoreboard')
  @RequiresPermission(AdminPermission.GAMES_READ)
  scoreboard(@Query() query: CharacterScoreboardQueryDto) {
    return this.bibleGames.scoreboard(
      null,
      query.period ?? 'month',
      query.limit ?? 100,
      'characters',
    );
  }

  @Put('settings')
  @RequiresPermission(AdminPermission.GAMES_WRITE)
  updateSettings(
    @Body() dto: BibleCharacterSettingsDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.characters.updateSettings(
      { onlyReviewed: dto.onlyReviewed, turnHours: dto.turnHours },
      admin,
    );
  }

  @Patch(':id')
  @RequiresPermission(AdminPermission.GAMES_WRITE)
  update(
    @Param('id', CharacterIdPipe) id: string,
    @Body() dto: UpdateBibleCharacterDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.characters.update(id, dto, admin);
  }
}
