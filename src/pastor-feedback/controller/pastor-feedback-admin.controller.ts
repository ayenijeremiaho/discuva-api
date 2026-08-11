import {
  Body,
  Controller,
  Delete,
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
  UpdatePastorFeedbackDto,
  RespondToFeedbackDto,
} from '../dto/pastor-feedback.dto';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { CurrentAdmin } from '../../admin/decorator/current-admin.decorator';
import { Admin } from '../../admin/entity/admin.entity';
import { RequiresModule } from '../../church-settings/decorator/requires-module.decorator';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';

@RequiresModule('pastor_feedback')
@UseGuards(AdminGuard, ModuleEnabledGuard)
@Controller('pastor-feedback/admin')
export class PastorFeedbackAdminController {
  constructor(private readonly feedbackService: PastorFeedbackService) {}

  @RequiresPermission(AdminPermission.PASTOR_FEEDBACK_READ)
  @Get()
  getAll(
    @Query('departmentId') departmentId?: string,
    @Query('weekOf') weekOf?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 10,
  ) {
    return this.feedbackService.getAllFeedback({
      departmentId,
      weekOf,
      page: Number(page),
      limit: Number(limit),
    });
  }

  @RequiresPermission(AdminPermission.PASTOR_FEEDBACK_READ)
  @Get('department/:departmentId')
  getForDepartment(
    @Param('departmentId', ParseUUIDPipe) departmentId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 10,
  ) {
    return this.feedbackService.getFeedbackForDepartment(
      departmentId,
      Number(page),
      Number(limit),
    );
  }

  @RequiresPermission(AdminPermission.PASTOR_FEEDBACK_WRITE)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePastorFeedbackDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.feedbackService.updateFeedbackAsAdmin(id, dto, admin.id);
  }

  @RequiresPermission(AdminPermission.PASTOR_FEEDBACK_WRITE)
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.feedbackService.deleteFeedbackAsAdmin(id);
  }

  // Lets an admin who is also the church's pastor (Admin.member has a Pastor
  // record) respond without needing to switch to the mobile app.
  @RequiresPermission(AdminPermission.PASTOR_FEEDBACK_WRITE)
  @Post(':id/respond')
  respond(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RespondToFeedbackDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.feedbackService.respondAsClergyReviewer(
      id,
      dto,
      admin.member.id,
    );
  }
}
