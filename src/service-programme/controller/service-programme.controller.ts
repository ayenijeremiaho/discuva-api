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
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { CurrentAdmin } from '../../admin/decorator/current-admin.decorator';
import { Admin } from '../../admin/entity/admin.entity';
import { PlanGuard } from '../../billing/guard/plan.guard';
import { RequiresPlan } from '../../billing/decorator/requires-plan.decorator';
import { PlanFeature } from '../../billing/enum/plan-feature.enum';
import { RequiresModule } from '../../church-settings/decorator/requires-module.decorator';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';
import { ServiceProgrammeService } from '../service/service-programme.service';
import { ServiceSessionService } from '../service/service-session.service';
import { CreateServiceProgrammeDto } from '../dto/create-service-programme.dto';
import { UpdateServiceProgrammeDto } from '../dto/update-service-programme.dto';
import { CreateServiceProgrammeSlotDto } from '../dto/create-service-programme-slot.dto';
import { UpdateServiceProgrammeSlotDto } from '../dto/update-service-programme-slot.dto';
import { ReorderProgrammeSlotsDto } from '../dto/reorder-programme-slots.dto';

// PlanGuard/ModuleEnabledGuard stacked at class level compose with each
// route's own AdminGuard/JwtAuthGuard (NestJS runs class-level and
// method-level @UseGuards() together, not one overriding the other) —
// applies to every route in this controller, admin and member
// ("my-assignments") alike, without needing the decorators repeated per
// method. KNOWN_MODULES has carried a 'service_programme' toggle entry
// since it was added, but no controller ever enforced it — this closes
// that gap so the admin's on/off switch actually does something.
@UseGuards(PlanGuard, ModuleEnabledGuard)
@RequiresPlan(PlanFeature.SERVICE_PROGRAMME)
@RequiresModule('service_programme')
@Controller('service-programme')
export class ServiceProgrammeController {
  constructor(
    private readonly programmeSvc: ServiceProgrammeService,
    private readonly sessionSvc: ServiceSessionService,
  ) {}

  @Post()
  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.SERVICE_PROGRAMME_WRITE)
  create(@Body() dto: CreateServiceProgrammeDto, @CurrentAdmin() admin: Admin) {
    return this.programmeSvc.create(dto, admin);
  }

  @Get()
  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.SERVICE_PROGRAMME_READ)
  findAll(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.programmeSvc.findAll(page ? +page : 1, limit ? +limit : 20);
  }

  @Get('templates')
  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.SERVICE_PROGRAMME_READ)
  findAllTemplates() {
    return this.programmeSvc.findAllTemplates();
  }

  @Delete('templates/:templateId')
  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.SERVICE_PROGRAMME_WRITE)
  removeTemplate(@Param('templateId', ParseUUIDPipe) templateId: string) {
    return this.programmeSvc.removeTemplate(templateId);
  }

  @Get('event/:eventId/pdf')
  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.SERVICE_PROGRAMME_READ)
  async downloadEventPdf(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Res() res: Response,
  ) {
    const { buffer, eventName } =
      await this.programmeSvc.downloadEventPdf(eventId);
    const safe = eventName.replace(/[^a-z0-9]/gi, '-').toLowerCase();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="programme-${safe}.pdf"`,
    );
    res.end(buffer);
  }

  @Get('my-assignments')
  @UseGuards(JwtAuthGuard)
  getMyAssignments(@CurrentUser() user: MemberAuth) {
    return this.programmeSvc.getMyUpcomingAssignments(user.id);
  }

  // The general order-of-service view — any authenticated member, not just
  // whoever has a slot in it. Must stay registered before ':id' below,
  // which would otherwise swallow this as a (malformed) uuid param.
  @Get('upcoming')
  @UseGuards(JwtAuthGuard)
  getUpcoming() {
    return this.programmeSvc.getUpcomingForMembers();
  }

  @Get(':id')
  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.SERVICE_PROGRAMME_READ)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.programmeSvc.findOne(id);
  }

  @Patch(':id')
  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.SERVICE_PROGRAMME_WRITE)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceProgrammeDto,
  ) {
    return this.programmeSvc.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.SERVICE_PROGRAMME_WRITE)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.programmeSvc.remove(id);
  }

  @Post(':id/slots')
  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.SERVICE_PROGRAMME_WRITE)
  addSlot(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateServiceProgrammeSlotDto,
  ) {
    return this.programmeSvc.addSlot(id, dto);
  }

  @Put(':id/slots/reorder')
  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.SERVICE_PROGRAMME_WRITE)
  reorderSlots(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReorderProgrammeSlotsDto,
  ) {
    return this.programmeSvc.reorderSlots(id, dto);
  }

  @Patch(':id/slots/:slotId')
  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.SERVICE_PROGRAMME_WRITE)
  updateSlot(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('slotId', ParseUUIDPipe) slotId: string,
    @Body() dto: UpdateServiceProgrammeSlotDto,
  ) {
    return this.programmeSvc.updateSlot(id, slotId, dto);
  }

  @Delete(':id/slots/:slotId')
  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.SERVICE_PROGRAMME_WRITE)
  removeSlot(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('slotId', ParseUUIDPipe) slotId: string,
  ) {
    return this.programmeSvc.removeSlot(id, slotId);
  }

  @Post(':id/apply-template/:templateId')
  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.SERVICE_PROGRAMME_WRITE)
  applyTemplate(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('templateId', ParseUUIDPipe) templateId: string,
  ) {
    return this.programmeSvc.applyTemplate(id, templateId);
  }

  @Get(':id/pdf')
  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.SERVICE_PROGRAMME_READ)
  async downloadPdf(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const buffer = await this.programmeSvc.downloadPdf(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="programme-${id}.pdf"`,
    );
    res.end(buffer);
  }

  @Get(':id/sessions')
  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.SERVICE_PROGRAMME_READ)
  getSessions(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.sessionSvc.getSessionHistory(
      id,
      page ? +page : 1,
      limit ? +limit : 20,
    );
  }
}
