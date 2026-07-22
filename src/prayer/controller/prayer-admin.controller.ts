import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { PrayerConfigService } from '../service/prayer-config.service';
import { PrayerMeetingService } from '../service/prayer-meeting.service';
import { PrayerRosterService } from '../service/prayer-roster.service';
import { RequiresModule } from '../../church-settings/decorator/requires-module.decorator';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';
import {
  ClonePrayerProgramDto,
  CreatePrayerDayConfigDto,
  CreatePrayerFixedAssignmentDto,
  CreatePrayerProgramDto,
  CreatePrayerScheduleRuleDto,
  GenerateMonthlyMeetingsDto,
  ManualAssignDto,
  OpenSelectionWindowDto,
  ReschedulePrayerEntryDto,
  UpdatePrayerDayConfigDto,
  UpdatePrayerProgramDto,
  UpdatePrayerScheduleRuleDto,
} from '../dto/prayer.dto';

@RequiresModule('prayer')
@UseGuards(AdminGuard, ModuleEnabledGuard)
@Controller('prayer/admin')
export class PrayerAdminController {
  constructor(
    private readonly configService: PrayerConfigService,
    private readonly meetingService: PrayerMeetingService,
    private readonly rosterService: PrayerRosterService,
  ) {}

  // ── Programs ────────────────────────────────────────────────────────────────

  @Get('programs')
  @RequiresPermission(AdminPermission.PRAYER_READ)
  listPrograms(@Query('name') name?: string) {
    return this.configService.listPrograms(undefined, name);
  }

  @Post('programs')
  @RequiresPermission(AdminPermission.PRAYER_WRITE)
  createProgram(@Body() dto: CreatePrayerProgramDto) {
    return this.configService.createProgram(dto);
  }

  @Patch('programs/:id')
  @RequiresPermission(AdminPermission.PRAYER_WRITE)
  updateProgram(@Param('id') id: string, @Body() dto: UpdatePrayerProgramDto) {
    return this.configService.updateProgram(id, dto);
  }

  @Delete('programs/:id')
  @RequiresPermission(AdminPermission.PRAYER_WRITE)
  deactivateProgram(@Param('id') id: string) {
    return this.configService.deactivateProgram(id);
  }

  @Post('programs/:id/clone')
  @RequiresPermission(AdminPermission.PRAYER_WRITE)
  cloneProgram(@Param('id') id: string, @Body() dto: ClonePrayerProgramDto) {
    return this.configService.cloneProgram(id, dto);
  }

  // ── Day Configs (scoped to program) ────────────────────────────────────────

  @Get('day-configs')
  @RequiresPermission(AdminPermission.PRAYER_READ)
  getDayConfigs(@Query('programId') programId: string) {
    return this.configService.getDayConfigs(programId);
  }

  @Post('day-configs')
  @RequiresPermission(AdminPermission.PRAYER_WRITE)
  createDayConfig(
    @Query('programId') programId: string,
    @Body() dto: CreatePrayerDayConfigDto,
  ) {
    return this.configService.createDayConfig(programId, dto);
  }

  @Patch('day-configs/:id')
  @RequiresPermission(AdminPermission.PRAYER_WRITE)
  updateDayConfig(
    @Param('id') id: string,
    @Body() dto: UpdatePrayerDayConfigDto,
  ) {
    return this.configService.updateDayConfig(id, dto);
  }

  // ── Rules (scoped to program) ───────────────────────────────────────────────

  @Get('rules')
  @RequiresPermission(AdminPermission.PRAYER_READ)
  getRules(@Query('programId') programId: string) {
    return this.configService.getRules(programId);
  }

  @Post('rules')
  @RequiresPermission(AdminPermission.PRAYER_WRITE)
  createRule(
    @Query('programId') programId: string,
    @Body() dto: CreatePrayerScheduleRuleDto,
  ) {
    return this.configService.createRule(programId, dto);
  }

  @Patch('rules/:id')
  @RequiresPermission(AdminPermission.PRAYER_WRITE)
  updateRule(
    @Param('id') id: string,
    @Body() dto: UpdatePrayerScheduleRuleDto,
  ) {
    return this.configService.updateRule(id, dto);
  }

  // ── Fixed Assignments (scoped to program) ───────────────────────────────────

  @Get('fixed-assignments')
  @RequiresPermission(AdminPermission.PRAYER_READ)
  getFixedAssignments(@Query('programId') programId: string) {
    return this.configService.getFixedAssignments(programId);
  }

  @Post('fixed-assignments')
  @RequiresPermission(AdminPermission.PRAYER_WRITE)
  createFixedAssignment(
    @Query('programId') programId: string,
    @Body() dto: CreatePrayerFixedAssignmentDto,
  ) {
    return this.configService.createFixedAssignment(programId, dto);
  }

  @Delete('fixed-assignments/:id')
  @RequiresPermission(AdminPermission.PRAYER_WRITE)
  removeFixedAssignment(@Param('id') id: string) {
    return this.configService.removeFixedAssignment(id);
  }

  // ── Meetings ────────────────────────────────────────────────────────────────

  @Post('meetings/generate')
  @RequiresPermission(AdminPermission.PRAYER_WRITE)
  generateMeetings(
    @Query('programId') programId: string,
    @Body() dto: GenerateMonthlyMeetingsDto,
  ) {
    return this.meetingService.generateMonthlyMeetings(programId, dto);
  }

  @Post('meetings/open-selection')
  @RequiresPermission(AdminPermission.PRAYER_WRITE)
  openSelection(
    @Query('programId') programId: string,
    @Body() dto: OpenSelectionWindowDto,
  ) {
    return this.meetingService.openSelectionWindow(programId, dto);
  }

  @Post('meetings/close-selection')
  @RequiresPermission(AdminPermission.PRAYER_WRITE)
  closeSelection(
    @Query('programId') programId: string,
    @Body() dto: OpenSelectionWindowDto,
  ) {
    return this.meetingService.closeSelectionWindow(programId, dto);
  }

  // ── Roster ──────────────────────────────────────────────────────────────────

  @Post('roster/auto-assign')
  @RequiresPermission(AdminPermission.PRAYER_WRITE)
  autoAssign(
    @Query('programId') programId: string,
    @Query('month') month: string,
    @Query('year') year: string,
  ) {
    return this.rosterService.autoAssign(
      programId,
      Number(month),
      Number(year),
    );
  }

  @Post('roster/manual-assign')
  @RequiresPermission(AdminPermission.PRAYER_WRITE)
  manualAssign(
    @Query('programId') programId: string,
    @Body() dto: ManualAssignDto,
  ) {
    return this.rosterService.manualAssign(programId, dto);
  }

  @Get('roster/validate')
  @RequiresPermission(AdminPermission.PRAYER_READ)
  validateRoster(
    @Query('programId') programId: string,
    @Query('month') month: string,
    @Query('year') year: string,
  ) {
    return this.rosterService.validateRoster(
      programId,
      Number(month),
      Number(year),
    );
  }

  @Get('roster/:month/:year')
  @RequiresPermission(AdminPermission.PRAYER_READ)
  getMonthlyRoster(
    @Param('month') month: string,
    @Param('year') year: string,
    @Query('programId') programId: string,
  ) {
    return this.meetingService.getMonthlyRoster(
      programId,
      Number(month),
      Number(year),
    );
  }

  @Patch('roster/entries/:id/reschedule')
  @RequiresPermission(AdminPermission.PRAYER_WRITE)
  reschedule(@Param('id') id: string, @Body() dto: ReschedulePrayerEntryDto) {
    return this.rosterService.reschedule(id, dto);
  }

  @Delete('roster/entries/:id')
  @RequiresPermission(AdminPermission.PRAYER_WRITE)
  removeEntry(@Param('id') id: string) {
    return this.rosterService.removeEntry(id);
  }
}
