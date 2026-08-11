import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { CurrentAdmin } from '../../admin/decorator/current-admin.decorator';
import { Admin } from '../../admin/entity/admin.entity';
import { ReminderSettingsService } from '../service/reminder-settings.service';
import { UpdateReminderSettingDto } from '../dto/reminder-setting.dto';
import { ReminderSettingKey } from '../enum/reminder-setting-key.enum';

@UseGuards(AdminGuard)
@Controller('admin/reminder-settings')
export class ReminderSettingsController {
  constructor(
    private readonly reminderSettingsService: ReminderSettingsService,
  ) {}

  @Get()
  findAll() {
    return this.reminderSettingsService.findAll();
  }

  @Get(':key')
  findOne(@Param('key') key: ReminderSettingKey) {
    return this.reminderSettingsService.findOne(key);
  }

  @RequiresPermission(AdminPermission.ADMIN_WRITE)
  @HttpCode(HttpStatus.OK)
  @Patch(':key')
  upsert(
    @Param('key') key: ReminderSettingKey,
    @Body() dto: UpdateReminderSettingDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.reminderSettingsService.upsert(key, dto, admin.member?.id);
  }
}
