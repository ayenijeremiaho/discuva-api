import { Body, Controller, Get, Patch, Query, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { CurrentUser } from '../../auth/decorator/current-user.decorator';
import { MemberAuth } from '../../auth/interface/auth.interface';
import { MembershipAnniversaryService } from '../service/membership-anniversary.service';
import { AnniversarySettingsService } from '../service/anniversary-settings.service';
import { UpdateAnniversarySettingsDto } from '../dto/anniversary-settings.dto';

@UseGuards(AdminGuard)
@Controller('anniversaries')
export class AnniversaryController {
  constructor(
    private readonly anniversaryService: MembershipAnniversaryService,
    private readonly settingsService: AnniversarySettingsService,
  ) {}

  @RequiresPermission(AdminPermission.MEMBERS_READ)
  @Get()
  list(@Query('days') days?: string) {
    const window = Math.min(Math.max(Number(days) || 7, 0), 365);
    return this.anniversaryService.getCelebrants(window);
  }

  @RequiresPermission(AdminPermission.MEMBERS_READ)
  @Get('settings')
  getSettings() {
    return this.settingsService.get();
  }

  @RequiresPermission(AdminPermission.ANNOUNCEMENTS_WRITE)
  @Patch('settings')
  updateSettings(
    @Body() dto: UpdateAnniversarySettingsDto,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.settingsService.update(dto, user.id);
  }
}
