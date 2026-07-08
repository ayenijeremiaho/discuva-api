import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsOptional, IsUUID } from 'class-validator';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { CurrentAdmin } from '../../admin/decorator/current-admin.decorator';
import { Admin } from '../../admin/entity/admin.entity';
import { FollowUpService } from '../service/follow-up.service';
import { CreateFirstTimerDto } from '../dto/create-first-timer.dto';
import { ReassignTaskDto } from '../dto/reassign-task.dto';
import { BulkUpdateTasksDto } from '../dto/bulk-update-tasks.dto';
import { AdminUpdateFollowUpTaskDto } from '../dto/admin-update-follow-up-task.dto';
import { LogVisitDto } from '../dto/log-visit.dto';
import {
  FirstTimerSourceEnum,
  FollowUpTaskStatusEnum,
  FollowUpTaskTypeEnum,
} from '../enums/follow-up.enum';

class MarkConvertedDto {
  @IsOptional()
  @IsUUID()
  memberId?: string;
}

@UseGuards(AdminGuard)
@Controller('admin/follow-up')
export class FollowUpAdminController {
  constructor(private readonly followUpService: FollowUpService) {}

  @RequiresPermission(AdminPermission.FOLLOW_UP_WRITE)
  @Post('first-timers')
  async createFirstTimer(
    @CurrentAdmin() admin: Admin,
    @Body() dto: CreateFirstTimerDto,
  ) {
    return this.followUpService.createFirstTimerByAdmin(dto, admin.id);
  }

  @RequiresPermission(AdminPermission.FOLLOW_UP_READ)
  @Get('first-timers')
  async getFirstTimers(
    @Query('page') page = 1,
    @Query('limit') limit = 20,
    @Query('eventId') eventId?: string,
    @Query('source') source?: FirstTimerSourceEnum,
    @Query('wantsToJoinChurch') wantsToJoinChurch?: string,
    @Query('wantsToJoinWorkforce') wantsToJoinWorkforce?: string,
    @Query('search') search?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    let joinChurch: boolean | undefined;
    if (wantsToJoinChurch === 'true') joinChurch = true;
    else if (wantsToJoinChurch === 'false') joinChurch = false;

    let joinWorkforce: boolean | undefined;
    if (wantsToJoinWorkforce === 'true') joinWorkforce = true;
    else if (wantsToJoinWorkforce === 'false') joinWorkforce = false;
    return this.followUpService.getFirstTimers(
      +page,
      +limit,
      eventId,
      source,
      joinChurch,
      joinWorkforce,
      search,
      dateFrom,
      dateTo,
    );
  }

  @RequiresPermission(AdminPermission.FOLLOW_UP_READ)
  @Get('tasks')
  async getAllTasks(
    @Query('page') page = 1,
    @Query('limit') limit = 20,
    @Query('status') status?: FollowUpTaskStatusEnum,
    @Query('type') type?: FollowUpTaskTypeEnum,
    @Query('search') search?: string,
  ) {
    return this.followUpService.getAllTasks(
      +page,
      +limit,
      status,
      type,
      search,
    );
  }

  @RequiresPermission(AdminPermission.FOLLOW_UP_WRITE)
  @Patch('tasks/:id/reassign')
  async reassignTask(
    @CurrentAdmin() admin: Admin,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReassignTaskDto,
  ) {
    return this.followUpService.reassignTask(id, dto, admin.id);
  }

  @RequiresPermission(AdminPermission.FOLLOW_UP_WRITE)
  @Patch('tasks/bulk')
  async bulkUpdateTasks(@Body() dto: BulkUpdateTasksDto) {
    return this.followUpService.bulkUpdateTasks(dto);
  }

  @RequiresPermission(AdminPermission.FOLLOW_UP_WRITE)
  @Post('first-timers/:id/invite-to-membership')
  async inviteToMembership(@Param('id', ParseUUIDPipe) id: string) {
    return this.followUpService.inviteFirstTimerToMembership(id);
  }

  @RequiresPermission(AdminPermission.FOLLOW_UP_WRITE)
  @Patch('first-timers/:id/mark-converted')
  async markConverted(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarkConvertedDto,
  ) {
    return this.followUpService.markConverted(id, dto.memberId);
  }

  @RequiresPermission(AdminPermission.FOLLOW_UP_WRITE)
  @Patch('tasks/:id')
  async adminUpdateTask(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminUpdateFollowUpTaskDto,
  ) {
    return this.followUpService.adminUpdateTask(id, dto);
  }

  @RequiresPermission(AdminPermission.FOLLOW_UP_READ)
  @Get('report')
  async getReport(@Query('from') from?: string, @Query('to') to?: string) {
    return this.followUpService.getReport(
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
    );
  }

  @RequiresPermission(AdminPermission.FOLLOW_UP_READ)
  @Get('first-timers/pipeline')
  async getPipeline(@Query('from') from?: string, @Query('to') to?: string) {
    return this.followUpService.getFirstTimerPipeline(from, to);
  }

  @RequiresPermission(AdminPermission.FOLLOW_UP_WRITE)
  @Post('first-timers/:id/visits')
  async logVisit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LogVisitDto,
  ) {
    return this.followUpService.logReturnVisit(id, dto);
  }

  @RequiresPermission(AdminPermission.FOLLOW_UP_READ)
  @Get('tasks/stale')
  async getStaleTasks(
    @Query('daysInactive') daysInactive = 7,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.followUpService.getStaleTasks(+daysInactive, +page, +limit);
  }
}
