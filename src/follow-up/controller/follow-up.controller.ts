import {
  Body,
  Controller,
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
import { CreateFirstTimerDto } from '../dto/create-first-timer.dto';
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
  constructor(private readonly followUpService: FollowUpService) {}

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
