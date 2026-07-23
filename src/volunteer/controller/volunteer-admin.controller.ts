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
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { CurrentAdmin } from '../../admin/decorator/current-admin.decorator';
import { Admin } from '../../admin/entity/admin.entity';
import { VolunteerService } from '../service/volunteer.service';
import {
  CreateVolunteerOpportunityDto,
  UpdateVolunteerOpportunityDto,
} from '../dto/volunteer-opportunity.dto';

@Controller('admin/volunteer-opportunities')
@UseGuards(AdminGuard)
export class VolunteerAdminController {
  constructor(private readonly volunteerService: VolunteerService) {}

  @Post()
  @RequiresPermission(AdminPermission.VOLUNTEER_WRITE)
  create(
    @Body() dto: CreateVolunteerOpportunityDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.volunteerService.create(dto, admin);
  }

  @Get()
  @RequiresPermission(AdminPermission.VOLUNTEER_READ)
  list(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.volunteerService.listOpportunities(
      page ? +page : 1,
      limit ? +limit : 20,
    );
  }

  @Patch(':id')
  @RequiresPermission(AdminPermission.VOLUNTEER_WRITE)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVolunteerOpportunityDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.volunteerService.update(id, dto, admin);
  }

  @Patch(':id/cancel')
  @RequiresPermission(AdminPermission.VOLUNTEER_WRITE)
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentAdmin() admin: Admin) {
    return this.volunteerService.cancelOpportunity(id, admin);
  }

  @Get(':id/signups')
  @RequiresPermission(AdminPermission.VOLUNTEER_READ)
  getRoster(@Param('id', ParseUUIDPipe) id: string) {
    return this.volunteerService.getRoster(id);
  }
}
