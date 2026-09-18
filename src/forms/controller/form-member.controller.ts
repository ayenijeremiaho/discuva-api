import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import 'multer';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorator/current-user.decorator';
import { MemberAuth } from '../../auth/interface/auth.interface';
import { RequiresModule } from '../../church-settings/decorator/requires-module.decorator';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';
import { PlanGuard } from '../../billing/guard/plan.guard';
import { RequiresPlan } from '../../billing/decorator/requires-plan.decorator';
import { PlanFeature } from '../../billing/enum/plan-feature.enum';
import { DynamicLimitedFileInterceptor } from '../../utility/interceptors/dynamic-limited-file.interceptor';
import { PlatformSettingKey } from '../../platform-admin/enum/platform-setting-key.enum';
import { UPLOAD_HARD_CEILING_BYTES } from '../../platform-admin/constant/known-platform-settings.constant';
import { FormSubmissionService } from '../service/form-submission.service';
import { FormAttemptService } from '../service/form-attempt.service';
import { SubmitFormDto } from '../dto/form.dto';
import { FormPurpose, FormVisibility } from '../enum/form.enum';

@RequiresModule('forms')
@RequiresPlan(PlanFeature.FORMS)
@UseGuards(JwtAuthGuard, ModuleEnabledGuard, PlanGuard)
@Controller('forms/member')
export class FormMemberController {
  constructor(
    private readonly submissionService: FormSubmissionService,
    private readonly attemptService: FormAttemptService,
  ) {}

  @Get()
  list(@CurrentUser() user: MemberAuth, @Query('eventId') eventId?: string) {
    return this.submissionService.listForMembers(eventId, user.id);
  }

  // "See scores/votes for previous events" — must be registered before
  // ':id' below or "history" would be swallowed as a form id and 400 on
  // ParseUUIDPipe.
  @Get('history')
  getHistory(
    @CurrentUser() user: MemberAuth,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('purpose') purpose?: 'QUIZ' | 'VOTE',
  ) {
    return this.submissionService.getMyHistory(
      user.id,
      page ? Number(page) : 1,
      limit ? Number(limit) : 20,
      purpose as FormPurpose.QUIZ | FormPurpose.VOTE | undefined,
    );
  }

  @Get(':id')
  getForFill(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.submissionService.getForMember(id, user.id);
  }

  // Starts (or returns, if one's already in progress) a time-limited
  // QUIZ's per-attempt countdown — see FormAttemptService.startOrGetAttempt.
  // A no-op call against a form with no timer, or that isn't a QUIZ, 400s.
  @Post(':id/start')
  startAttempt(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.attemptService.startOrGetAttemptById(id, user.id);
  }

  @Post(':id/submit')
  submit(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: MemberAuth,
    @Body() dto: SubmitFormDto,
  ) {
    return this.submissionService.submitAsMember(id, user.id, dto.answers);
  }

  // Powers the "you already submitted — edit it?" flow reached from a
  // DUPLICATE_SUBMISSION error on submit() above. `editable` in the
  // response reflects Form.editableAfterSubmit.
  @Get(':id/submission')
  getMySubmission(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.submissionService.getMySubmission(id, user.id);
  }

  // Not nested under :id — ownership + the form's own editableAfterSubmit
  // are both resolved from the submission record itself, same as every
  // other check in this controller resolves from the form/member tokens
  // rather than trusting anything from the URL beyond an id.
  @Patch('submissions/:submissionId')
  updateSubmission(
    @Param('submissionId', ParseUUIDPipe) submissionId: string,
    @CurrentUser() user: MemberAuth,
    @Body() dto: SubmitFormDto,
  ) {
    return this.submissionService.updateSubmission(
      submissionId,
      user.id,
      dto.answers,
    );
  }

  // Upload-then-reference: the returned { url, publicId } becomes the
  // answer value for this FILE field in the normal POST :id/submit call —
  // see FormSubmissionService.uploadAttachment.
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
    @CurrentUser() user: MemberAuth,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No file provided');
    return this.submissionService.uploadAttachment(
      id,
      fieldId,
      file,
      [FormVisibility.MEMBERS, FormVisibility.PUBLIC],
      user.id,
    );
  }
}
