import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { CurrentAdmin } from '../../admin/decorator/current-admin.decorator';
import { Admin } from '../../admin/entity/admin.entity';
import { PlanGuard } from '../../billing/guard/plan.guard';
import { RequiresPlan } from '../../billing/decorator/requires-plan.decorator';
import { PlanFeature } from '../../billing/enum/plan-feature.enum';
import { GameService } from '../service/game.service';
import { GameSessionGateway } from '../gateway/game-session.gateway';
import {
  CreateGameDto,
  CreateGameQuestionDto,
  GameQueryDto,
  ReorderQuestionsDto,
  UpdateGameDto,
  UpdateGameQuestionDto,
} from '../dto/game.dto';

@UseGuards(AdminGuard, PlanGuard)
@RequiresPlan(PlanFeature.GAMES)
@Controller('admin/games')
export class AdminGameController {
  constructor(
    private readonly gameService: GameService,
    private readonly gateway: GameSessionGateway,
  ) {}

  @RequiresPermission(AdminPermission.GAMES_WRITE)
  @Post()
  create(@Body() dto: CreateGameDto, @CurrentAdmin() admin: Admin) {
    return this.gameService.createGame(dto, admin);
  }

  @RequiresPermission(AdminPermission.GAMES_READ)
  @Get()
  findAll(@Query() query: GameQueryDto) {
    const { page = 1, limit = 20 } = query;
    return this.gameService.listGames(page, limit);
  }

  @RequiresPermission(AdminPermission.GAMES_READ)
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.gameService.getGame(id);
  }

  @RequiresPermission(AdminPermission.GAMES_WRITE)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGameDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.gameService.updateGame(id, dto, admin);
  }

  @RequiresPermission(AdminPermission.GAMES_WRITE)
  @Delete(':id')
  delete(@Param('id', ParseUUIDPipe) id: string, @CurrentAdmin() admin: Admin) {
    return this.gameService.deleteGame(id, admin);
  }

  @RequiresPermission(AdminPermission.GAMES_READ)
  @Get(':id/questions')
  listQuestions(@Param('id', ParseUUIDPipe) id: string) {
    return this.gameService.listQuestions(id);
  }

  @RequiresPermission(AdminPermission.GAMES_WRITE)
  @Post(':id/questions')
  addQuestion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateGameQuestionDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.gameService.addQuestion(id, dto, admin);
  }

  @RequiresPermission(AdminPermission.GAMES_WRITE)
  @Put(':id/questions/reorder')
  reorderQuestions(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReorderQuestionsDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.gameService.reorderQuestions(id, dto, admin);
  }

  @RequiresPermission(AdminPermission.GAMES_WRITE)
  @Patch('questions/:questionId')
  updateQuestion(
    @Param('questionId', ParseUUIDPipe) questionId: string,
    @Body() dto: UpdateGameQuestionDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.gameService.updateQuestion(questionId, dto, admin);
  }

  @RequiresPermission(AdminPermission.GAMES_WRITE)
  @Delete('questions/:questionId')
  deleteQuestion(
    @Param('questionId', ParseUUIDPipe) questionId: string,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.gameService.deleteQuestion(questionId, admin);
  }

  @RequiresPermission(AdminPermission.GAMES_WRITE)
  @Post(':id/start')
  async startSession(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAdmin() admin: Admin,
  ) {
    const session = await this.gameService.startSession(id, admin);
    const state = await this.gameService.getSessionState(session.sessionCode);
    this.gateway.broadcastState(session.sessionCode, state);
    return session;
  }

  @RequiresPermission(AdminPermission.GAMES_WRITE)
  @Post('sessions/:code/next-question')
  async nextQuestion(
    @Param('code') code: string,
    @CurrentAdmin() admin: Admin,
  ) {
    const state = await this.gameService.nextQuestion(code, admin);
    this.gateway.broadcastState(code, state);
    return state;
  }

  @RequiresPermission(AdminPermission.GAMES_WRITE)
  @Post('sessions/:code/end')
  async endSession(@Param('code') code: string, @CurrentAdmin() admin: Admin) {
    const state = await this.gameService.endSession(code, admin);
    this.gateway.broadcastState(code, state);
    return state;
  }

  @RequiresPermission(AdminPermission.GAMES_READ)
  @Get('sessions/:code/state')
  getSessionState(@Param('code') code: string) {
    return this.gameService.getSessionState(code);
  }

  @RequiresPermission(AdminPermission.GAMES_READ)
  @Get('sessions/:code/leaderboard')
  getLeaderboard(@Param('code') code: string) {
    return this.gameService.getLeaderboard(code);
  }
}
