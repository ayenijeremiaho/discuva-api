import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { CurrentAdmin } from '../../admin/decorator/current-admin.decorator';
import { Admin } from '../../admin/entity/admin.entity';
import { RequiresModule } from '../../church-settings/decorator/requires-module.decorator';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';
import {
  MAX_LISTED_DAYS,
  MAX_OPEN_DAYS,
  VolunteerChatSettingsService,
} from '../service/volunteer-chat-settings.service';

export class VolunteerChatSettingsDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_OPEN_DAYS)
  openDays: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LISTED_DAYS)
  listedDays: number;
}

@RequiresModule('team_spaces')
@UseGuards(AdminGuard, ModuleEnabledGuard)
@Controller('admin/team-spaces/volunteering-settings')
export class VolunteerChatSettingsController {
  constructor(private readonly settings: VolunteerChatSettingsService) {}

  @Get()
  @RequiresPermission(AdminPermission.VOLUNTEER_READ)
  get() {
    return this.settings.get();
  }

  @Put()
  @RequiresPermission(AdminPermission.VOLUNTEER_WRITE)
  save(@Body() dto: VolunteerChatSettingsDto, @CurrentAdmin() admin: Admin) {
    return this.settings.save(
      { openDays: dto.openDays, listedDays: dto.listedDays },
      admin.member?.id,
    );
  }
}
