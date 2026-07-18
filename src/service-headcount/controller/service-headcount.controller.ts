import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { CurrentAdmin } from '../../admin/decorator/current-admin.decorator';
import { Admin } from '../../admin/entity/admin.entity';
import {
  HeadcountPeriod,
  ServiceHeadcountService,
} from '../service/service-headcount.service';
import { CreateServiceHeadcountDto } from '../dto/create-service-headcount.dto';

@Controller('service-headcount')
@UseGuards(AdminGuard)
export class ServiceHeadcountController {
  constructor(private readonly headcountSvc: ServiceHeadcountService) {}

  @Post()
  @RequiresPermission(AdminPermission.HEADCOUNT_WRITE)
  create(@Body() dto: CreateServiceHeadcountDto, @CurrentAdmin() admin: Admin) {
    return this.headcountSvc.create(dto, admin);
  }

  @Get()
  @RequiresPermission(AdminPermission.HEADCOUNT_READ)
  findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('serviceSlotId') serviceSlotId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.headcountSvc.findAll(
      page ? +page : 1,
      limit ? +limit : 20,
      serviceSlotId,
      from,
      to,
    );
  }

  @Get('trends')
  @RequiresPermission(AdminPermission.HEADCOUNT_READ)
  getTrends(
    @Query('period') period?: HeadcountPeriod,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('serviceSlotName') serviceSlotName?: string,
  ) {
    return this.headcountSvc.getTrends(
      period ?? 'weekly',
      from,
      to,
      serviceSlotName,
    );
  }

  @Get('event/:eventId/summary')
  @RequiresPermission(AdminPermission.HEADCOUNT_READ)
  getEventSummary(@Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.headcountSvc.getEventSummary(eventId);
  }

  @Get(':id')
  @RequiresPermission(AdminPermission.HEADCOUNT_READ)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.headcountSvc.findOne(id);
  }
}
