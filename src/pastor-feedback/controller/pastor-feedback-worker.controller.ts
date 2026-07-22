import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PastorFeedbackService } from '../service/pastor-feedback.service';
import {
  SubmitPastorFeedbackDto,
  UpdatePastorFeedbackDto,
} from '../dto/pastor-feedback.dto';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorator/current-user.decorator';
import { MemberAuth } from '../../auth/interface/auth.interface';
import { RequiresModule } from '../../church-settings/decorator/requires-module.decorator';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';

@RequiresModule('pastor_feedback')
@UseGuards(JwtAuthGuard, ModuleEnabledGuard)
@Controller('pastor-feedback')
export class PastorFeedbackWorkerController {
  constructor(private readonly feedbackService: PastorFeedbackService) {}

  @Post()
  submit(
    @Body() dto: SubmitPastorFeedbackDto,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.feedbackService.submitFeedback(dto, user);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePastorFeedbackDto,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.feedbackService.updateOwnFeedback(id, dto, user);
  }

  @Get('my')
  getMySubmissions(
    @CurrentUser() user: MemberAuth,
    @Query('page') page = 1,
    @Query('limit') limit = 10,
  ) {
    return this.feedbackService.getMySubmissions(
      user,
      Number(page),
      Number(limit),
    );
  }
}
