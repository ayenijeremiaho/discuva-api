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
import { EmailCategorySettingsService } from '../service/email-category-settings.service';
import { UpdateEmailCategorySettingDto } from '../dto/email-category-setting.dto';
import { EmailCategory } from '../../utility/email-provider/email-category.enum';

@UseGuards(AdminGuard)
@Controller('admin/email-category-settings')
export class EmailCategorySettingsController {
  constructor(
    private readonly emailCategorySettingsService: EmailCategorySettingsService,
  ) {}

  @Get()
  findAll() {
    return this.emailCategorySettingsService.findAll();
  }

  @Get(':category')
  findOne(@Param('category') category: EmailCategory) {
    return this.emailCategorySettingsService.findOne(category);
  }

  @RequiresPermission(AdminPermission.ADMIN_WRITE)
  @HttpCode(HttpStatus.OK)
  @Patch(':category')
  upsert(
    @Param('category') category: EmailCategory,
    @Body() dto: UpdateEmailCategorySettingDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.emailCategorySettingsService.upsert(
      category,
      dto,
      admin.member?.id,
    );
  }
}
