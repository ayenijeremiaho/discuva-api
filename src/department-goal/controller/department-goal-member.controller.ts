import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorator/current-user.decorator';
import { MemberAuth } from '../../auth/interface/auth.interface';
import { RequiresModule } from '../../church-settings/decorator/requires-module.decorator';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';
import { DepartmentGoalService } from '../service/department-goal.service';
import { DepartmentGoalApprovalService } from '../service/department-goal-approval.service';
import {
  CreateGoalDto,
  SubmitRatingDto,
  UpdateGoalDto,
} from '../dto/department-goal.dto';

// Mounted at a distinct `department-goals/member` sub-path, not the same
// base as DepartmentGoalAdminController's `:id` wildcard — same
// route-ordering rationale ChurchCalendarMemberController already
// documents for this codebase's public/admin controller pairs.
@RequiresModule('department_goals')
@UseGuards(JwtAuthGuard, ModuleEnabledGuard)
@Controller('department-goals/member')
export class DepartmentGoalMemberController {
  constructor(
    private readonly goalService: DepartmentGoalService,
    private readonly approvalService: DepartmentGoalApprovalService,
  ) {}

  @Get('current')
  getCurrent(@CurrentUser() user: MemberAuth) {
    return this.goalService.getCurrentForMember(user.id);
  }

  @Post('cycles/:cycleId/departments/:departmentId/goals')
  createGoal(
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Param('departmentId', ParseUUIDPipe) departmentId: string,
    @Body() dto: CreateGoalDto,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.goalService.createGoal(cycleId, departmentId, dto, user.id);
  }

  @Patch('cycles/:cycleId/departments/:departmentId/goals/:goalId')
  updateGoal(
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Param('departmentId', ParseUUIDPipe) departmentId: string,
    @Param('goalId', ParseUUIDPipe) goalId: string,
    @Body() dto: UpdateGoalDto,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.goalService.updateGoalAsHod(
      cycleId,
      departmentId,
      goalId,
      dto,
      user.id,
    );
  }

  @Delete('cycles/:cycleId/departments/:departmentId/goals/:goalId')
  deleteGoal(
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Param('departmentId', ParseUUIDPipe) departmentId: string,
    @Param('goalId', ParseUUIDPipe) goalId: string,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.goalService.deleteGoalAsHod(
      cycleId,
      departmentId,
      goalId,
      user.id,
    );
  }

  @Post('cycles/:cycleId/departments/:departmentId/goals/:goalId/self-rating')
  submitSelfRating(
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Param('departmentId', ParseUUIDPipe) departmentId: string,
    @Param('goalId', ParseUUIDPipe) goalId: string,
    @Body() dto: SubmitRatingDto,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.goalService.submitSelfRating(
      cycleId,
      departmentId,
      goalId,
      dto,
      user.id,
    );
  }

  @Get('cycles/:cycleId/departments/:departmentId/approval')
  getApproval(
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Param('departmentId', ParseUUIDPipe) departmentId: string,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.approvalService.getApprovalStatusForMember(
      cycleId,
      departmentId,
      user.id,
    );
  }

  @Get('cycles/:cycleId/departments/:departmentId/comments')
  getComments(
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Param('departmentId', ParseUUIDPipe) departmentId: string,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.approvalService.getThreadForMember(
      cycleId,
      departmentId,
      user.id,
    );
  }

  @Get('cycles/:cycleId/departments/:departmentId/goals/:goalId/history')
  getGoalHistory(
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Param('departmentId', ParseUUIDPipe) departmentId: string,
    @Param('goalId', ParseUUIDPipe) goalId: string,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.goalService.getGoalHistory(
      cycleId,
      departmentId,
      goalId,
      user.id,
    );
  }

  @Get('cycles/:cycleId/departments/:departmentId/pdf')
  async downloadPdf(
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Param('departmentId', ParseUUIDPipe) departmentId: string,
    @CurrentUser() user: MemberAuth,
    @Res() res: Response,
  ) {
    const pdf = await this.goalService.generatePdf(
      cycleId,
      departmentId,
      user.id,
    );
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="department-goals-${cycleId}.pdf"`,
      'Content-Length': pdf.length,
    });
    res.end(pdf);
  }
}
