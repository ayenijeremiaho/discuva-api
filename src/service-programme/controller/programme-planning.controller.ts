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
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
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
import { SaveProgrammeTemplateDto } from '../dto/save-programme-template.dto';

const pdfName = (name: string) =>
  `${
    name
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase() || 'order-of-service'
  }.pdf`;

// Building orders of service from the member app. A separate prefix keeps these clear of /service-programme/:id.
// Every change and download is in the audit log (via: member_app).
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
  async create(
    @CurrentUser() user: MemberAuth,
    @Body() dto: CreatePlannedProgrammeDto,
  ) {
    const programme = await this.planning.create(user.id, dto);
    this.planning.audit(
      'PROGRAMME_CREATED',
      user.id,
      ProgrammePlanningService.nameOf(programme),
      {
        ...(dto.templateId && { templateId: dto.templateId }),
        ...(dto.copyFromProgrammeId && { copiedFrom: dto.copyFromProgrammeId }),
        items: programme.items.length,
      },
    );
    return programme;
  }

  @UseGuards(ProgrammePlannerGuard)
  @Get('programmes/:id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.planning.view(id);
  }

  @UseGuards(ProgrammePlannerGuard)
  @Delete('programmes/:id')
  async remove(
    @CurrentUser() user: MemberAuth,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const programme = await this.planning.view(id);
    await this.programmes.remove(id);
    this.planning.audit(
      'PROGRAMME_DELETED',
      user.id,
      ProgrammePlanningService.nameOf(programme),
    );
  }

  @UseGuards(ProgrammePlannerGuard)
  @Post('programmes/:id/items')
  async addItem(
    @CurrentUser() user: MemberAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateServiceProgrammeSlotDto,
  ) {
    const saved = await this.programmes.addSlot(id, dto);
    const programme = await this.planning.view(id, saved.conflictWarning);
    this.planning.audit(
      'PROGRAMME_ITEM_ADDED',
      user.id,
      ProgrammePlanningService.nameOf(programme),
      {
        item: saved.id,
        topic: dto.topic ?? dto.type,
      },
    );
    return programme;
  }

  @UseGuards(ProgrammePlannerGuard)
  @Put('programmes/:id/items/reorder')
  async reorder(
    @CurrentUser() user: MemberAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReorderProgrammeSlotsDto,
  ) {
    await this.programmes.reorderSlots(id, dto);
    const programme = await this.planning.view(id);
    this.planning.audit(
      'PROGRAMME_REORDERED',
      user.id,
      ProgrammePlanningService.nameOf(programme),
    );
    return programme;
  }

  @UseGuards(ProgrammePlannerGuard)
  @Patch('programmes/:id/items/:itemId')
  async updateItem(
    @CurrentUser() user: MemberAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: UpdateServiceProgrammeSlotDto,
  ) {
    const saved = await this.programmes.updateSlot(id, itemId, dto);
    const programme = await this.planning.view(id, saved.conflictWarning);
    this.planning.audit(
      'PROGRAMME_ITEM_UPDATED',
      user.id,
      ProgrammePlanningService.nameOf(programme),
      {
        item: itemId,
        topic: saved.topic ?? saved.type,
        changed: Object.keys(dto),
      },
    );
    return programme;
  }

  @UseGuards(ProgrammePlannerGuard)
  @Delete('programmes/:id/items/:itemId')
  async removeItem(
    @CurrentUser() user: MemberAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ) {
    await this.programmes.removeSlot(id, itemId);
    const programme = await this.planning.view(id);
    this.planning.audit(
      'PROGRAMME_ITEM_REMOVED',
      user.id,
      ProgrammePlanningService.nameOf(programme),
      {
        item: itemId,
      },
    );
    return programme;
  }

  @UseGuards(ProgrammePlannerGuard)
  @Post('programmes/:id/template')
  async saveTemplate(
    @CurrentUser() user: MemberAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveProgrammeTemplateDto,
  ) {
    const template = await this.programmes.saveAsNamedTemplate(
      id,
      dto.name.trim(),
    );
    const programme = await this.planning.view(id);
    this.planning.audit(
      'PROGRAMME_TEMPLATE_SAVED',
      user.id,
      ProgrammePlanningService.nameOf(programme),
      {
        template: template.name,
        replaced: template.replaced,
      },
    );
    return template;
  }

  @UseGuards(ProgrammePlannerGuard)
  @Get('programmes/:id/pdf')
  async pdf(
    @CurrentUser() user: MemberAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const [programme, buffer] = await Promise.all([
      this.planning.view(id),
      this.programmes.downloadPdf(id),
    ]);
    this.planning.audit(
      'PROGRAMME_PDF_DOWNLOADED',
      user.id,
      ProgrammePlanningService.nameOf(programme),
    );
    const name = [programme.event?.name, programme.service?.name]
      .filter(Boolean)
      .join(' ');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${pdfName(name)}"`,
    );
    res.end(buffer);
  }

  // The whole event's order of service, every service in one PDF.
  @UseGuards(ProgrammePlannerGuard)
  @Get('events/:eventId/pdf')
  async eventPdf(
    @CurrentUser() user: MemberAuth,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Res() res: Response,
  ) {
    const { buffer, eventName } =
      await this.programmes.downloadEventPdf(eventId);
    this.planning.audit(
      'PROGRAMME_PDF_DOWNLOADED',
      user.id,
      { id: eventId, name: eventName },
      { scope: 'event' },
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${pdfName(eventName)}"`,
    );
    res.end(buffer);
  }
}
