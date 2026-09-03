import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import 'multer';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../auth/decorator/public.decorator';
import { RequiresModule } from '../../church-settings/decorator/requires-module.decorator';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';
import { PlanGuard } from '../../billing/guard/plan.guard';
import { RequiresPlan } from '../../billing/decorator/requires-plan.decorator';
import { PlanFeature } from '../../billing/enum/plan-feature.enum';
import { DynamicLimitedFileInterceptor } from '../../utility/interceptors/dynamic-limited-file.interceptor';
import { PlatformSettingKey } from '../../platform-admin/enum/platform-setting-key.enum';
import { UPLOAD_HARD_CEILING_BYTES } from '../../platform-admin/constant/known-platform-settings.constant';
import { FormSubmissionService } from '../service/form-submission.service';
import { SubmitFormDto } from '../dto/form.dto';
import { FormVisibility } from '../enum/form.enum';

// No login required — the whole point of a PUBLIC-visibility form is that
// anyone with the link can fill it in, church member or not. PlanGuard still
// applies: it keys off the tenant resolved by TenantMiddleware, not the
// caller's auth, so an unauthenticated visitor of a Free-tier tenant is
// still correctly blocked.
@Public()
@RequiresModule('forms')
@RequiresPlan(PlanFeature.FORMS)
@UseGuards(ModuleEnabledGuard, PlanGuard)
@Controller('forms/public')
export class FormPublicController {
  constructor(private readonly submissionService: FormSubmissionService) {}

  @Get(':id')
  getForFill(@Param('id', ParseUUIDPipe) id: string) {
    return this.submissionService.getForPublic(id);
  }

  // Rate-limited — this is an open, unauthenticated write endpoint.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post(':id/submit')
  submit(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SubmitFormDto) {
    return this.submissionService.submitAsPublic(id, dto.answers);
  }

  // Upload-then-reference: the returned { url, publicId } becomes the
  // answer value for this FILE field in the normal POST :id/submit call —
  // see FormSubmissionService.uploadAttachment. Rate-limited for the same
  // reason as submit() — open, unauthenticated write endpoint.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post(':id/fields/:fieldId/attachment')
  @UseInterceptors(
    DynamicLimitedFileInterceptor(
      'file',
      PlatformSettingKey.MAX_FORM_ATTACHMENT_UPLOAD_MB,
      UPLOAD_HARD_CEILING_BYTES[
        PlatformSettingKey.MAX_FORM_ATTACHMENT_UPLOAD_MB
      ],
    ),
  )
  uploadAttachment(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fieldId', ParseUUIDPipe) fieldId: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No file provided');
    return this.submissionService.uploadAttachment(id, fieldId, file, [
      FormVisibility.PUBLIC,
    ]);
  }
}
