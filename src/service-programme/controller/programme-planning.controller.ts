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
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorator/current-user.decorator';
import { MemberAuth } from '../../auth/interface/auth.interface';
import { PlanGuard } from '../../billing/guard/plan.guard';
import { RequiresPlan } from '../../billing/decorator/requires-plan.decorator';
import { PlanFeature } from '../../billing/enum/plan-feature.enum';
import { RequiresModule } from '../../church-settings/decorator/requires-module.decorator';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';
import { ServiceProgrammeService } from '../service/service-programme.service';
import { ProgrammePlanningService } from '../service/programme-planning.service';
import { ProgrammePlannerGuard } from '../guard/programme-planner.guard';
import { CreatePlannedProgrammeDto } from '../dto/create-planned-programme.dto';
import { CreateServiceProgrammeSlotDto } from '../dto/create-service-programme-slot.dto';
import { UpdateServiceProgrammeSlotDto } from '../dto/update-service-programme-slot.dto';
import { ReorderProgrammeSlotsDto } from '../dto/reorder-programme-slots.dto';

// Building orders of service from the member app. A separate prefix keeps these clear of /service-programme/:id.
@UseGuards(JwtAuthGuard, PlanGuard, ModuleEnabledGuard)
@RequiresPlan(PlanFeature.SERVICE_PROGRAMME)
@RequiresModule('service_programme')
@Controller('programme-planning')
export class ProgrammePlanningController {
  constructor(
    private readonly planning: ProgrammePlanningService,
    private readonly programmes: ServiceProgrammeService,
  ) {}

  // Lets the app decide whether to show the planner, for admins as well as capability workers.
  @Get('access')
  async access(@CurrentUser() user: MemberAuth) {
    return { canPlan: await this.planning.canPlan(user.id) };
  }

  @UseGuards(ProgrammePlannerGuard)
  @Get('events')
  upcoming(@Query('days') days?: string) {
    const n = Number(days);
    return this.planning.upcoming(
      Number.isInteger(n) && n > 0 && n <= 180 ? n : undefined,
    );
  }

  @UseGuards(ProgrammePlannerGuard)
  @Get('people')
  people(@Query('q') q = '') {
    return this.planning.people(q);
  }

  @UseGuards(ProgrammePlannerGuard)
  @Get('templates')
  templates() {
    return this.programmes.findAllTemplates();
  }

  @UseGuards(ProgrammePlannerGuard)
  @Post('programmes')
  create(
    @CurrentUser() user: MemberAuth,
    @Body() dto: CreatePlannedProgrammeDto,
  ) {
    return this.planning.create(user.id, dto);
  }

  @UseGuards(ProgrammePlannerGuard)
  @Get('programmes/:id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.planning.view(id);
  }

  @UseGuards(ProgrammePlannerGuard)
  @Delete('programmes/:id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.programmes.remove(id);
  }

  @UseGuards(ProgrammePlannerGuard)
  @Post('programmes/:id/items')
  async addItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateServiceProgrammeSlotDto,
  ) {
    const saved = await this.programmes.addSlot(id, dto);
    return this.planning.view(id, saved.conflictWarning);
  }

  @UseGuards(ProgrammePlannerGuard)
  @Put('programmes/:id/items/reorder')
  async reorder(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReorderProgrammeSlotsDto,
  ) {
    await this.programmes.reorderSlots(id, dto);
    return this.planning.view(id);
  }

  @UseGuards(ProgrammePlannerGuard)
  @Patch('programmes/:id/items/:itemId')
  async updateItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: UpdateServiceProgrammeSlotDto,
  ) {
    const saved = await this.programmes.updateSlot(id, itemId, dto);
    return this.planning.view(id, saved.conflictWarning);
  }

  @UseGuards(ProgrammePlannerGuard)
  @Delete('programmes/:id/items/:itemId')
  async removeItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ) {
    await this.programmes.removeSlot(id, itemId);
    return this.planning.view(id);
  }
}
