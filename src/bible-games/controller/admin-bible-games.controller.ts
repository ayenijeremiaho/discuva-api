import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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
import { BibleGamesService } from '../service/bible-games.service';
import { BibleGamesAdminService } from '../service/bible-games-admin.service';
import {
  CustomQuestionDto,
  HideQuestionDto,
  PreviewQueryDto,
  ScoreboardQueryDto,
  UpdateCustomQuestionDto,
} from '../dto/bible-game.dto';

@RequiresModule('bible_games')
@UseGuards(AdminGuard, ModuleEnabledGuard)
@Controller('admin/bible-games')
export class AdminBibleGamesController {
  constructor(
    private readonly bibleGames: BibleGamesService,
    private readonly admin: BibleGamesAdminService,
  ) {}

  @Get('scoreboard')
  @RequiresPermission(AdminPermission.GAMES_READ)
  scoreboard(@Query() query: ScoreboardQueryDto) {
    return this.bibleGames.scoreboard(
      null,
      query.period ?? 'month',
      query.limit ?? 100,
    );
  }

  @Get('stats')
  @RequiresPermission(AdminPermission.GAMES_READ)
  stats() {
    return this.admin.stats();
  }

  @Get('questions/preview')
  @RequiresPermission(AdminPermission.GAMES_READ)
  preview(@Query() query: PreviewQueryDto) {
    return this.admin.preview(query.level, query.seed ?? 0);
  }

  @Get('questions/hidden')
  @RequiresPermission(AdminPermission.GAMES_READ)
  hidden() {
    return this.admin.hiddenList();
  }

  @Post('questions/hidden')
  @RequiresPermission(AdminPermission.GAMES_WRITE)
  hide(@Body() dto: HideQuestionDto, @CurrentAdmin() admin: Admin) {
    return this.admin.hide(dto, admin.id);
  }

  // Keys contain ":" and ".", so they travel in the query string.
  @Delete('questions/hidden')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequiresPermission(AdminPermission.GAMES_WRITE)
  unhide(@Query('key') key: string, @CurrentAdmin() admin: Admin) {
    return this.admin.unhide(key, admin.id);
  }

  @Get('questions/custom')
  @RequiresPermission(AdminPermission.GAMES_READ)
  listCustom() {
    return this.admin.listCustom();
  }

  @Post('questions/custom')
  @RequiresPermission(AdminPermission.GAMES_WRITE)
  createCustom(@Body() dto: CustomQuestionDto, @CurrentAdmin() admin: Admin) {
    return this.admin.createCustom(dto, admin.id);
  }

  @Patch('questions/custom/:id')
  @RequiresPermission(AdminPermission.GAMES_WRITE)
  updateCustom(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomQuestionDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.admin.updateCustom(id, dto, admin.id);
  }

  @Delete('questions/custom/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequiresPermission(AdminPermission.GAMES_WRITE)
  deleteCustom(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.admin.deleteCustom(id, admin.id);
  }
}
