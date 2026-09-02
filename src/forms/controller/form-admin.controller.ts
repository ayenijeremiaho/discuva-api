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
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Response } from 'express';
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
import { FormService } from '../service/form.service';
import { FormSubmissionService } from '../service/form-submission.service';
import { GroupService } from '../../group/service/group.service';
import {
  AdminSubmitFormDto,
  CreateFormDto,
  UpdateFormDto,
} from '../dto/form.dto';

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

@RequiresModule('forms')
@RequiresPlan(PlanFeature.FORMS)
@UseGuards(AdminGuard, ModuleEnabledGuard, PlanGuard)
@Controller('forms')
export class FormAdminController {
  constructor(
    private readonly formService: FormService,
    private readonly submissionService: FormSubmissionService,
    private readonly groupService: GroupService,
  ) {}

  // Own route + FORMS_WRITE gate rather than reusing GroupController's
  // GET /groups/lookup (gated on ANNOUNCEMENTS_WRITE) — an admin who can
  // manage forms shouldn't need a second, unrelated permission grant just
  // to pick a Contact List to restrict a form's audience to. Must be
  // registered before ':id' or it'd be swallowed as an id param.
  @RequiresPermission(AdminPermission.FORMS_WRITE)
  @Get('audience-groups/lookup')
  getAudienceGroupLookup() {
    return this.groupService.getLookup();
  }

  @RequiresPermission(AdminPermission.FORMS_WRITE)
  @Post()
  create(@Body() dto: CreateFormDto) {
    return this.formService.create(dto);
  }

  @RequiresPermission(AdminPermission.FORMS_READ)
  @Get()
  getAll() {
    return this.formService.getAll();
  }

  @RequiresPermission(AdminPermission.FORMS_READ)
  @Get(':id')
  getById(@Param('id', ParseUUIDPipe) id: string) {
    return this.formService.getById(id);
  }

  @RequiresPermission(AdminPermission.FORMS_WRITE)
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateFormDto) {
    return this.formService.update(id, dto);
  }

  @RequiresPermission(AdminPermission.FORMS_WRITE)
  @Delete(':id')
  delete(@Param('id', ParseUUIDPipe) id: string) {
    return this.formService.delete(id);
  }

  @RequiresPermission(AdminPermission.FORMS_WRITE)
  @Post(':id/cover')
  @UseInterceptors(
    DynamicLimitedFileInterceptor(
      'cover',
      PlatformSettingKey.MAX_LOGO_UPLOAD_MB,
      UPLOAD_HARD_CEILING_BYTES[PlatformSettingKey.MAX_LOGO_UPLOAD_MB],
      { fileFilter: imageOnlyFilter },
    ),
  )
  uploadCover(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() cover?: Express.Multer.File,
  ) {
    if (!cover) throw new BadRequestException('No cover image provided');
    return this.formService.setCoverImage(id, cover);
  }

  @RequiresPermission(AdminPermission.FORMS_WRITE)
  @Delete(':id/cover')
  removeCover(@Param('id', ParseUUIDPipe) id: string) {
    return this.formService.removeCoverImage(id);
  }

  @RequiresPermission(AdminPermission.FORMS_WRITE)
  @Post(':id/logo')
  @UseInterceptors(
    DynamicLimitedFileInterceptor(
      'logo',
      PlatformSettingKey.MAX_LOGO_UPLOAD_MB,
      UPLOAD_HARD_CEILING_BYTES[PlatformSettingKey.MAX_LOGO_UPLOAD_MB],
      { fileFilter: imageOnlyFilter },
    ),
  )
  uploadLogo(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() logo?: Express.Multer.File,
  ) {
    if (!logo) throw new BadRequestException('No logo file provided');
    return this.formService.setLogo(id, logo);
  }

  @RequiresPermission(AdminPermission.FORMS_WRITE)
  @Delete(':id/logo')
  removeLogo(@Param('id', ParseUUIDPipe) id: string) {
    return this.formService.removeLogo(id);
  }

  @RequiresPermission(AdminPermission.FORMS_READ)
  @Get(':id/submissions')
  getSubmissions(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.formService.getSubmissions(
      id,
      page ? Number(page) : 1,
      limit ? Number(limit) : 20,
    );
  }

  // The only way a submission is ever created against an ADMIN_ONLY-
  // visibility form — but works against any visibility, not just
  // ADMIN_ONLY (see FormSubmissionService.submitAsAdmin).
  @RequiresPermission(AdminPermission.FORMS_WRITE)
  @Post(':id/submissions')
  createSubmission(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminSubmitFormDto,
  ) {
    return this.submissionService.submitAsAdmin(id, dto.answers, dto.memberId);
  }

  @RequiresPermission(AdminPermission.FORMS_READ)
  @Get(':id/analytics')
  getAnalytics(@Param('id', ParseUUIDPipe) id: string) {
    return this.formService.getAnalytics(id);
  }

  @RequiresPermission(AdminPermission.FORMS_READ)
  @Get(':id/submissions/export')
  async exportSubmissions(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const csv = await this.formService.getSubmissionsCsv(id);
    res.set({
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="form-submissions-${id}.csv"`,
    });
    res.end(csv);
  }
}
