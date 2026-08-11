import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorator/current-user.decorator';
import { MemberAuth } from '../../auth/interface/auth.interface';
import { RequiresModule } from '../../church-settings/decorator/requires-module.decorator';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';
import { PlanGuard } from '../../billing/guard/plan.guard';
import { RequiresPlan } from '../../billing/decorator/requires-plan.decorator';
import { PlanFeature } from '../../billing/enum/plan-feature.enum';
import { FormSubmissionService } from '../service/form-submission.service';
import { SubmitFormDto } from '../dto/form.dto';

@RequiresModule('forms')
@RequiresPlan(PlanFeature.FORMS)
@UseGuards(JwtAuthGuard, ModuleEnabledGuard, PlanGuard)
@Controller('forms/member')
export class FormMemberController {
  constructor(private readonly submissionService: FormSubmissionService) {}

  @Get()
  list(@Query('eventId') eventId?: string) {
    return this.submissionService.listForMembers(eventId);
  }

  @Get(':id')
  getForFill(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.submissionService.getForMember(id, user.id);
  }

  @Post(':id/submit')
  submit(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: MemberAuth,
    @Body() dto: SubmitFormDto,
  ) {
    return this.submissionService.submitAsMember(id, user.id, dto.answers);
  }
}
