import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorator/current-user.decorator';
import { MemberAuth } from '../../auth/interface/auth.interface';
import { RequiresModule } from '../../church-settings/decorator/requires-module.decorator';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';
import { ServingRotaService } from '../service/serving-rota.service';
import {
  GenerateRotaDto,
  RequestCoverDto,
  SaveRotaDto,
  SaveRotaUnavailabilityDto,
} from '../dto/serving-rota.dto';
import {
  SaveRotaEligibilityDto,
  SaveRotaPlannersDto,
  SaveRotaResponsibilityDto,
  SaveRotaScheduleDto,
  SaveRotaSubteamDto,
} from '../dto/rota-setup.dto';
import { RotaSetupService } from '../service/rota-setup.service';
import { RotaAllocationService } from '../service/rota-allocation.service';
import { RotaCustomService } from '../service/rota-custom.service';

const Uuid = (name: string) => Param(name, ParseUUIDPipe);

@RequiresModule('serving_rota')
@UseGuards(JwtAuthGuard, ModuleEnabledGuard)
@Controller('rota')
export class ServingRotaController {
  constructor(
    private readonly rota: ServingRotaService,
    private readonly setup: RotaSetupService,
    private readonly allocation: RotaAllocationService,
    private readonly custom: RotaCustomService,
  ) {}

  @Get('mine')
  mine(@CurrentUser() user: MemberAuth) {
    return this.rota.mine(user.id);
  }

  @Get('departments')
  departments(@CurrentUser() user: MemberAuth) {
    return this.rota.departments(user.id);
  }

  @Get('availability/absent')
  unavailable(@CurrentUser() user: MemberAuth) {
    return this.allocation.mine(user.id);
  }

  @Post('availability/absent')
  saveUnavailable(
    @CurrentUser() user: MemberAuth,
    @Body() dto: SaveRotaUnavailabilityDto,
  ) {
    return this.allocation.saveUnavailable(user.id, dto);
  }

  @Delete('availability/absent/:date')
  removeUnavailable(
    @CurrentUser() user: MemberAuth,
    @Param('date') date: string,
  ) {
    return this.allocation.removeUnavailable(user.id, date);
  }

  @Get('departments/:departmentId/services')
  services(
    @CurrentUser() user: MemberAuth,
    @Uuid('departmentId') departmentId: string,
  ) {
    return this.rota.services(user.id, departmentId);
  }

  @Get('departments/:departmentId/custom-sessions')
  customSessions(
    @CurrentUser() user: MemberAuth,
    @Uuid('departmentId') departmentId: string,
  ) {
    return this.custom.list(user.id, departmentId);
  }

  @Get('departments/:departmentId/custom-sessions/:scheduleId/:date')
  customSession(
    @CurrentUser() user: MemberAuth,
    @Uuid('departmentId') departmentId: string,
    @Uuid('scheduleId') scheduleId: string,
    @Param('date') date: string,
  ) {
    return this.custom.detail(user.id, departmentId, scheduleId, date);
  }

  @Put('departments/:departmentId/custom-sessions/:scheduleId/:date')
  saveCustomSession(
    @CurrentUser() user: MemberAuth,
    @Uuid('departmentId') departmentId: string,
    @Uuid('scheduleId') scheduleId: string,
    @Param('date') date: string,
    @Body() dto: SaveRotaDto,
  ) {
    return this.custom.save(user.id, departmentId, scheduleId, date, dto.entries);
  }

  @Post('departments/:departmentId/custom-sessions/:scheduleId/:date/generate')
  generateCustomSession(
    @CurrentUser() user: MemberAuth,
    @Uuid('departmentId') departmentId: string,
    @Uuid('scheduleId') scheduleId: string,
    @Param('date') date: string,
    @Body() dto: GenerateRotaDto,
  ) {
    return this.allocation.generateCustom(
      user.id,
      departmentId,
      scheduleId,
      date,
      dto.lockedEntries,
    );
  }

  @Post('custom-assignments/:assignmentId/absent')
  customAssignmentAbsent(
    @CurrentUser() user: MemberAuth,
    @Uuid('assignmentId') assignmentId: string,
  ) {
    return this.custom.markAbsent(user.id, assignmentId);
  }

  @Get('departments/:departmentId/setup')
  getSetup(
    @CurrentUser() user: MemberAuth,
    @Uuid('departmentId') departmentId: string,
  ) {
    return this.setup.get(user.id, departmentId);
  }

  @Post('departments/:departmentId/setup/subteams')
  createSubteam(
    @CurrentUser() user: MemberAuth,
    @Uuid('departmentId') departmentId: string,
    @Body() dto: SaveRotaSubteamDto,
  ) {
    return this.setup.createSubteam(user.id, departmentId, dto);
  }

  @Put('departments/:departmentId/setup/subteams/:id')
  updateSubteam(
    @CurrentUser() user: MemberAuth,
    @Uuid('departmentId') departmentId: string,
    @Uuid('id') id: string,
    @Body() dto: SaveRotaSubteamDto,
  ) {
    return this.setup.updateSubteam(user.id, departmentId, id, dto);
  }

  @Delete('departments/:departmentId/setup/subteams/:id')
  deleteSubteam(
    @CurrentUser() user: MemberAuth,
    @Uuid('departmentId') departmentId: string,
    @Uuid('id') id: string,
  ) {
    return this.setup.deleteSubteam(user.id, departmentId, id);
  }

  @Post('departments/:departmentId/setup/responsibilities')
  createResponsibility(
    @CurrentUser() user: MemberAuth,
    @Uuid('departmentId') departmentId: string,
    @Body() dto: SaveRotaResponsibilityDto,
  ) {
    return this.setup.createResponsibility(user.id, departmentId, dto);
  }

  @Put('departments/:departmentId/setup/responsibilities/:id')
  updateResponsibility(
    @CurrentUser() user: MemberAuth,
    @Uuid('departmentId') departmentId: string,
    @Uuid('id') id: string,
    @Body() dto: SaveRotaResponsibilityDto,
  ) {
    return this.setup.updateResponsibility(user.id, departmentId, id, dto);
  }

  @Delete('departments/:departmentId/setup/responsibilities/:id')
  deleteResponsibility(
    @CurrentUser() user: MemberAuth,
    @Uuid('departmentId') departmentId: string,
    @Uuid('id') id: string,
  ) {
    return this.setup.deleteResponsibility(user.id, departmentId, id);
  }

  @Put('departments/:departmentId/setup/responsibilities/:id/members')
  saveEligibility(
    @CurrentUser() user: MemberAuth,
    @Uuid('departmentId') departmentId: string,
    @Uuid('id') id: string,
    @Body() dto: SaveRotaEligibilityDto,
  ) {
    return this.setup.saveEligibility(user.id, departmentId, id, dto);
  }

  @Put('departments/:departmentId/setup/planners')
  savePlanners(
    @CurrentUser() user: MemberAuth,
    @Uuid('departmentId') departmentId: string,
    @Body() dto: SaveRotaPlannersDto,
  ) {
    return this.setup.savePlanners(user.id, departmentId, dto.planners);
  }

  @Post('departments/:departmentId/setup/schedules')
  createSchedule(
    @CurrentUser() user: MemberAuth,
    @Uuid('departmentId') departmentId: string,
    @Body() dto: SaveRotaScheduleDto,
  ) {
    return this.setup.createSchedule(user.id, departmentId, dto);
  }

  @Put('departments/:departmentId/setup/schedules/:id')
  updateSchedule(
    @CurrentUser() user: MemberAuth,
    @Uuid('departmentId') departmentId: string,
    @Uuid('id') id: string,
    @Body() dto: SaveRotaScheduleDto,
  ) {
    return this.setup.updateSchedule(user.id, departmentId, id, dto);
  }

  @Delete('departments/:departmentId/setup/schedules/:id')
  deleteSchedule(
    @CurrentUser() user: MemberAuth,
    @Uuid('departmentId') departmentId: string,
    @Uuid('id') id: string,
  ) {
    return this.setup.deleteSchedule(user.id, departmentId, id);
  }

  @Get('departments/:departmentId/services/:slotId')
  slot(
    @CurrentUser() user: MemberAuth,
    @Uuid('departmentId') departmentId: string,
    @Uuid('slotId') slotId: string,
  ) {
    return this.rota.slotRota(user.id, departmentId, slotId);
  }

  @Post('departments/:departmentId/services/:slotId/generate')
  generate(
    @CurrentUser() user: MemberAuth,
    @Uuid('departmentId') departmentId: string,
    @Uuid('slotId') slotId: string,
    @Body() dto: GenerateRotaDto,
  ) {
    return this.allocation.generate(
      user.id,
      departmentId,
      slotId,
      dto.lockedEntries,
    );
  }

  @Put('departments/:departmentId/services/:slotId')
  save(
    @CurrentUser() user: MemberAuth,
    @Uuid('departmentId') departmentId: string,
    @Uuid('slotId') slotId: string,
    @Body() dto: SaveRotaDto,
  ) {
    return this.rota.saveSlotRota(user.id, departmentId, slotId, dto.entries);
  }

  @Post('departments/:departmentId/services/:slotId/nudge')
  nudge(
    @CurrentUser() user: MemberAuth,
    @Uuid('departmentId') departmentId: string,
    @Uuid('slotId') slotId: string,
  ) {
    return this.rota.nudgeNotCheckedIn(user.id, departmentId, slotId);
  }

  @Post('assignments/:assignmentId/cover')
  requestCover(
    @CurrentUser() user: MemberAuth,
    @Uuid('assignmentId') assignmentId: string,
    @Body() dto: RequestCoverDto,
  ) {
    return this.rota.requestCover(user.id, assignmentId, dto);
  }

  @Post('cover/:requestId/accept')
  accept(
    @CurrentUser() user: MemberAuth,
    @Uuid('requestId') requestId: string,
  ) {
    return this.rota.acceptCover(user.id, requestId);
  }

  @Delete('cover/:requestId')
  cancel(
    @CurrentUser() user: MemberAuth,
    @Uuid('requestId') requestId: string,
  ) {
    return this.rota.cancelCover(user.id, requestId);
  }
}
