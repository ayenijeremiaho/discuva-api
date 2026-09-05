import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import 'multer';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { RequiresModule } from '../../church-settings/decorator/requires-module.decorator';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';
import { PlanGuard } from '../../billing/guard/plan.guard';
import { RequiresPlan } from '../../billing/decorator/requires-plan.decorator';
import { PlanFeature } from '../../billing/enum/plan-feature.enum';
import { DynamicLimitedFileInterceptor } from '../../utility/interceptors/dynamic-limited-file.interceptor';
import { PlatformSettingKey } from '../../platform-admin/enum/platform-setting-key.enum';
import { UPLOAD_HARD_CEILING_BYTES } from '../../platform-admin/constant/known-platform-settings.constant';
import { ChurchCalendarService } from '../service/church-calendar.service';
import {
  CreateChurchCalendarDto,
  UpdateChurchCalendarDto,
} from '../dto/church-calendar.dto';

function imageOnlyFilter(
  _req: Express.Request,
  file: Express.Multer.File,
  cb: (error: Error | null, acceptFile: boolean) => void,
) {
  if (!file.mimetype.startsWith('image/')) {
    return cb(new BadRequestException('Only image files are allowed'), false);
  }
  cb(null, true);
}

@RequiresModule('church_calendar')
@RequiresPlan(PlanFeature.CHURCH_CALENDAR)
@UseGuards(AdminGuard, ModuleEnabledGuard, PlanGuard)
@Controller('church-calendar')
export class ChurchCalendarAdminController {
  constructor(private readonly calendarService: ChurchCalendarService) {}

  @RequiresPermission(AdminPermission.CHURCH_CALENDAR_WRITE)
  @Post()
  create(@Body() dto: CreateChurchCalendarDto) {
    return this.calendarService.create(dto);
  }

  @RequiresPermission(AdminPermission.CHURCH_CALENDAR_READ)
  @Get()
  getAll() {
    return this.calendarService.getAll();
  }

  @RequiresPermission(AdminPermission.CHURCH_CALENDAR_READ)
  @Get(':id')
  getById(@Param('id', ParseUUIDPipe) id: string) {
    return this.calendarService.getById(id);
  }

  @RequiresPermission(AdminPermission.CHURCH_CALENDAR_WRITE)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateChurchCalendarDto,
  ) {
    return this.calendarService.update(id, dto);
  }

  @RequiresPermission(AdminPermission.CHURCH_CALENDAR_WRITE)
  @Delete(':id')
  delete(@Param('id', ParseUUIDPipe) id: string) {
    return this.calendarService.delete(id);
  }

  // Generic image upload for any entry's photo slot — returns a reference
  // only, see ChurchCalendarService.uploadEntryImage's own comment.
  @RequiresPermission(AdminPermission.CHURCH_CALENDAR_WRITE)
  @Post(':id/images')
  @UseInterceptors(
    DynamicLimitedFileInterceptor(
      'file',
      PlatformSettingKey.MAX_CHURCH_CALENDAR_IMAGE_UPLOAD_MB,
      UPLOAD_HARD_CEILING_BYTES[
        PlatformSettingKey.MAX_CHURCH_CALENDAR_IMAGE_UPLOAD_MB
      ],
      { fileFilter: imageOnlyFilter },
    ),
  )
  uploadEntryImage(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No image provided');
    return this.calendarService.uploadEntryImage(id, file);
  }
}
