import { Controller, Get, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../admin/guard/admin.guard';
import { RequiresPermission } from '../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../admin/enum/admin-permission.enum';
import { NotificationCentreService } from './notification-centre.service';

@UseGuards(AdminGuard)
@Controller('admin/notification-centre')
export class NotificationCentreController {
  constructor(private readonly centre: NotificationCentreService) {}

  @RequiresPermission(AdminPermission.ADMIN_READ)
  @Get()
  overview() {
    return this.centre.overview();
  }
}
