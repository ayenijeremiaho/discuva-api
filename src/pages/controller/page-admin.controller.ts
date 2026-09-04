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
import { DynamicLimitedFileInterceptor } from '../../utility/interceptors/dynamic-limited-file.interceptor';
import { PlatformSettingKey } from '../../platform-admin/enum/platform-setting-key.enum';
import { UPLOAD_HARD_CEILING_BYTES } from '../../platform-admin/constant/known-platform-settings.constant';
import { PageService } from '../service/page.service';
import { CreatePageDto, UpdatePageDto } from '../dto/page.dto';

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

@RequiresModule('pages')
@UseGuards(AdminGuard, ModuleEnabledGuard)
@Controller('pages')
export class PageAdminController {
  constructor(private readonly pageService: PageService) {}

  // The admin frontend's "Coming Soon" gate reads this — a lightweight,
  // side-effect-free access ping rather than a real functional endpoint, so
  // the Pages page can decide what to render before touching anything else.
  // Pages is early-access and gated entirely through Tenant.moduleOverrides
  // — 'pages' is deliberately never added to any Plan.features array, same
  // rollout posture Social Media used before it went GA (see
  // MakeSocialMediaOverrideOnly1793736000000's own comment). A platform
  // admin grants access to specific churches under test from
  // discuva-platform's Tenants page (Force On), and every other tenant's
  // ModuleEnabledGuard check above 403s before this handler is ever
  // reached — so simply reaching this handler at all already proves access.
  @RequiresPermission(AdminPermission.PAGES_READ)
  @Get('platform-enabled')
  isPlatformEnabled() {
    return { enabled: true };
  }

  @RequiresPermission(AdminPermission.PAGES_WRITE)
  @Post()
  create(@Body() dto: CreatePageDto) {
    return this.pageService.create(dto);
  }

  @RequiresPermission(AdminPermission.PAGES_READ)
  @Get()
  getAll() {
    return this.pageService.getAll();
  }

  @RequiresPermission(AdminPermission.PAGES_READ)
  @Get(':id')
  getById(@Param('id', ParseUUIDPipe) id: string) {
    return this.pageService.getById(id);
  }

  @RequiresPermission(AdminPermission.PAGES_WRITE)
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePageDto) {
    return this.pageService.update(id, dto);
  }

  @RequiresPermission(AdminPermission.PAGES_WRITE)
  @Delete(':id')
  delete(@Param('id', ParseUUIDPipe) id: string) {
    return this.pageService.delete(id);
  }

  // Generic image upload for any section's image slot (hero background,
  // speaker photos, gallery) — returns a reference only, see
  // PageService.uploadSectionImage's own comment.
  @RequiresPermission(AdminPermission.PAGES_WRITE)
  @Post(':id/images')
  @UseInterceptors(
    DynamicLimitedFileInterceptor(
      'file',
      PlatformSettingKey.MAX_PAGE_IMAGE_UPLOAD_MB,
      UPLOAD_HARD_CEILING_BYTES[PlatformSettingKey.MAX_PAGE_IMAGE_UPLOAD_MB],
      { fileFilter: imageOnlyFilter },
    ),
  )
  uploadSectionImage(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No image provided');
    return this.pageService.uploadSectionImage(id, file);
  }

  @RequiresPermission(AdminPermission.PAGES_WRITE)
  @Post(':id/og-image')
  @UseInterceptors(
    DynamicLimitedFileInterceptor(
      'file',
      PlatformSettingKey.MAX_PAGE_IMAGE_UPLOAD_MB,
      UPLOAD_HARD_CEILING_BYTES[PlatformSettingKey.MAX_PAGE_IMAGE_UPLOAD_MB],
      { fileFilter: imageOnlyFilter },
    ),
  )
  uploadOgImage(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No image provided');
    return this.pageService.setOgImage(id, file);
  }

  @RequiresPermission(AdminPermission.PAGES_WRITE)
  @Delete(':id/og-image')
  removeOgImage(@Param('id', ParseUUIDPipe) id: string) {
    return this.pageService.removeOgImage(id);
  }
}
