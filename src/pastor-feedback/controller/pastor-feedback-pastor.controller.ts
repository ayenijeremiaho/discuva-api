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
import { PastorFeedbackService } from '../service/pastor-feedback.service';
import { RespondToFeedbackDto } from '../dto/pastor-feedback.dto';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorator/current-user.decorator';
import { MemberAuth } from '../../auth/interface/auth.interface';
import { RequiresModule } from '../../church-settings/decorator/requires-module.decorator';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';

@RequiresModule('pastor_feedback')
@UseGuards(JwtAuthGuard, ModuleEnabledGuard)
@Controller('pastor-feedback/pastor')
export class PastorFeedbackPastorController {
  constructor(private readonly feedbackService: PastorFeedbackService) {}

  @Get()
  async getAll(
    @CurrentUser() user: MemberAuth,
    @Query('departmentId') departmentId?: string,
    @Query('weekOf') weekOf?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 10,
  ) {
    await this.feedbackService.assertIsPastor(user.id);
    return this.feedbackService.getAllFeedback({
      departmentId,
      weekOf,
      page: Number(page),
      limit: Number(limit),
    });
  }

  @Get('department/:departmentId')
  async getForDepartment(
    @CurrentUser() user: MemberAuth,
    @Param('departmentId', ParseUUIDPipe) departmentId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 10,
  ) {
    await this.feedbackService.assertIsPastor(user.id);
    return this.feedbackService.getFeedbackForDepartment(
      departmentId,
      Number(page),
      Number(limit),
    );
  }

  @Post(':id/respond')
  respond(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RespondToFeedbackDto,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.feedbackService.respondAsPastor(id, dto, user.id);
  }
}
