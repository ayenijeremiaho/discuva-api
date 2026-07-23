import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { CurrentAdmin } from '../../admin/decorator/current-admin.decorator';
import { Admin } from '../../admin/entity/admin.entity';
import { ServiceRatingService } from '../service/service-rating.service';

@Controller('admin/service-ratings')
@UseGuards(AdminGuard)
export class ServiceRatingAdminController {
  constructor(private readonly serviceRatingService: ServiceRatingService) {}

  @Get('summary')
  @RequiresPermission(AdminPermission.SERVICE_RATING_READ)
  getSummary(
    @Query('eventId') eventId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.serviceRatingService.getSummary(eventId, from, to);
  }

  @Get('comments')
  @RequiresPermission(AdminPermission.SERVICE_RATING_READ)
  getComments(
    @CurrentAdmin() admin: Admin,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.serviceRatingService.getComments(
      admin,
      page ? +page : 1,
      limit ? +limit : 20,
    );
  }

  @Delete(':id')
  @RequiresPermission(AdminPermission.SERVICE_RATING_MODERATE)
  moderateDelete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.serviceRatingService.moderateDelete(id, admin);
  }
}
