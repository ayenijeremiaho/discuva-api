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
import { AssignmentService } from '../service/assignment.service';
import {
  CreateAssignmentDto,
  GradeAssignmentDto,
  SubmitAssignmentDto,
  UpdateAssignmentDto,
} from '../dto/assignment.dto';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { MemberAuth } from '../../auth/interface/auth.interface';
import { CurrentUser } from '../../auth/decorator/current-user.decorator';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { CurrentAdmin } from '../../admin/decorator/current-admin.decorator';
import { Admin } from '../../admin/entity/admin.entity';
import { RequiresModule } from '../../church-settings/decorator/requires-module.decorator';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';

@RequiresModule('classes')
@UseGuards(JwtAuthGuard, ModuleEnabledGuard)
@Controller('classes')
export class AssignmentController {
  constructor(private readonly assignmentService: AssignmentService) {}

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CLASSES_WRITE)
  @Post(':classId/assignments')
  create(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Body() dto: CreateAssignmentDto,
  ) {
    return this.assignmentService.create(classId, dto);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CLASSES_READ)
  @Get(':classId/assignments')
  getForClass(@Param('classId', ParseUUIDPipe) classId: string) {
    return this.assignmentService.getForClass(classId);
  }

  @Get(':classId/assignments/available')
  getAvailableForMember(
    @Param('classId', ParseUUIDPipe) classId: string,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.assignmentService.getAvailableForMember(classId, user.id);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CLASSES_WRITE)
  @Patch('assignments/:assignmentId')
  update(
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Body() dto: UpdateAssignmentDto,
  ) {
    return this.assignmentService.update(assignmentId, dto);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CLASSES_WRITE)
  @Delete('assignments/:assignmentId')
  delete(@Param('assignmentId', ParseUUIDPipe) assignmentId: string) {
    return this.assignmentService.delete(assignmentId);
  }

  @Post('assignments/:assignmentId/submit')
  submit(
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Body() dto: SubmitAssignmentDto,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.assignmentService.submit(assignmentId, user.id, dto);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CLASSES_READ)
  @Get('assignments/:assignmentId/submissions')
  getSubmissions(
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.assignmentService.getSubmissions(
      assignmentId,
      Number(page),
      Number(limit),
    );
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CLASSES_WRITE)
  @Patch('assignments/submissions/:submissionId/grade')
  grade(
    @Param('submissionId', ParseUUIDPipe) submissionId: string,
    @Body() dto: GradeAssignmentDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.assignmentService.grade(submissionId, dto, admin.id);
  }
}
