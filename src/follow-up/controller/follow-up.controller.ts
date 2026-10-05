import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { RolesGuard } from '../../auth/guard/roles.guard';
import { Roles } from '../../auth/decorator/roles.decorator';
import { MemberRoleEnum } from '../../member/enums/member-role.enum';
import { FollowUpService } from '../service/follow-up.service';
import { FirstTimerConvertService } from '../service/first-timer-convert.service';
import { LinkConvertDto } from '../dto/link-convert.dto';
import { CreateFirstTimerDto } from '../dto/create-first-timer.dto';
import { UpdateFirstTimerDto } from '../dto/update-first-timer.dto';
import { UpdateFollowUpTaskDto } from '../dto/update-follow-up-task.dto';
import { AddNoteDto } from '../dto/add-note.dto';
import { FollowUpTaskStatusEnum } from '../enums/follow-up.enum';
import { RequiresModule } from '../../church-settings/decorator/requires-module.decorator';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';

@RequiresModule('follow_up')
@UseGuards(RolesGuard, ModuleEnabledGuard)
@Roles(MemberRoleEnum.WORKER)
@Controller('follow-up')
export class FollowUpController {
  constructor(
    private readonly followUpService: FollowUpService,
    private readonly firstTimerConvertService: FirstTimerConvertService,
  ) {}

  @Post('first-timers')
  async createFirstTimer(
    @Request() req: any,
    @Body() dto: CreateFirstTimerDto,
  ) {
    return this.followUpService.createFirstTimerByWorker(dto, req.user.id);
  }

  @Get('tasks/mine')
  async getMyTasks(
    @Request() req: any,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
    @Query('status') status?: FollowUpTaskStatusEnum,
  ) {
    return this.followUpService.getMyTasks(req.user.id, +page, +limit, status);
  }

  @Get('first-timers/:id')
  async getFirstTimerDetail(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.followUpService.getFirstTimerDetailForWorker(id, req.user.id);
  }

  @Post('first-timers/:id/link-convert')
  async linkConvert(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LinkConvertDto,
  ) {
    await this.followUpService.assertWorkerInFollowUpDept(req.user.id);
    return this.firstTimerConvertService.link(id, dto.convertId, req.user.id);
  }

  @Post('first-timers/:id/dismiss-convert')
  async dismissConvert(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LinkConvertDto,
  ) {
    await this.followUpService.assertWorkerInFollowUpDept(req.user.id);
    return this.firstTimerConvertService.dismiss(id, dto.convertId);
  }

  @Delete('first-timers/:id/link-convert')
  async unlinkConvert(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.followUpService.assertWorkerInFollowUpDept(req.user.id);
    return this.firstTimerConvertService.unlink(id, req.user.id);
  }

  @Patch('first-timers/:id')
  async updateFirstTimer(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFirstTimerDto,
  ) {
    return this.followUpService.updateFirstTimerByWorker(id, dto, req.user.id);
  }

  @Patch('tasks/:id')
  async updateTask(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFollowUpTaskDto,
  ) {
    return this.followUpService.updateTask(id, dto, req.user.id);
  }

  @Post('tasks/:id/notes')
  async addNote(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddNoteDto,
  ) {
    return this.followUpService.addNote(id, req.user.id, dto);
  }
}
