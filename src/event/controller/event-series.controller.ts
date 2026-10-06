import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { CurrentAdmin } from '../../admin/decorator/current-admin.decorator';
import { Admin } from '../../admin/entity/admin.entity';
import { EventSeriesService } from '../service/event-series.service';
import { EventService } from '../service/event.service';
import { EventTemplateService } from '../service/event-template.service';
import {
  StopEventSeriesDto,
  UpdateEventSeriesDto,
  UpsertEventTemplateDto,
} from '../dto/event-series.dto';

// Registered before EventController so these paths aren't taken as an event id.
@UseGuards(AdminGuard)
@Controller('events/series')
export class EventSeriesController {
  constructor(private readonly seriesService: EventSeriesService) {}

  @RequiresPermission(AdminPermission.EVENTS_READ)
  @Get()
  list() {
    return this.seriesService.list();
  }

  @RequiresPermission(AdminPermission.EVENTS_READ)
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.seriesService.get(id);
  }

  @RequiresPermission(AdminPermission.EVENTS_WRITE)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEventSeriesDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.seriesService.update(id, dto, admin.member.id);
  }

  @RequiresPermission(AdminPermission.EVENTS_WRITE)
  @Post(':id/stop')
  stop(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StopEventSeriesDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.seriesService.stop(id, dto.from, admin.member.id);
  }
}

@UseGuards(AdminGuard)
@Controller('events/templates')
export class EventTemplateController {
  constructor(private readonly templateService: EventTemplateService) {}

  @RequiresPermission(AdminPermission.EVENTS_READ)
  @Get()
  list() {
    return this.templateService.findAll();
  }

  @RequiresPermission(AdminPermission.EVENTS_WRITE)
  @Post()
  create(@Body() dto: UpsertEventTemplateDto, @CurrentAdmin() admin: Admin) {
    return this.templateService.create(dto, admin.member.id);
  }

  @RequiresPermission(AdminPermission.EVENTS_WRITE)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertEventTemplateDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.templateService.update(id, dto, admin.member.id);
  }

  @RequiresPermission(AdminPermission.EVENTS_WRITE)
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentAdmin() admin: Admin) {
    return this.templateService.remove(id, admin.member.id);
  }
}

@UseGuards(AdminGuard)
@Controller('events/audience-groups')
export class EventAudienceController {
  constructor(private readonly eventService: EventService) {}

  @RequiresPermission(AdminPermission.EVENTS_WRITE)
  @Get()
  list() {
    return this.eventService.listAudienceGroups();
  }
}
