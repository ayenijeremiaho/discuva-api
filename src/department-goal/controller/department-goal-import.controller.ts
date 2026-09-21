import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Response } from 'express';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { CurrentAdmin } from '../../admin/decorator/current-admin.decorator';
import { Admin } from '../../admin/entity/admin.entity';
import { RequiresModule } from '../../church-settings/decorator/requires-module.decorator';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';
import { LimitedFileInterceptor } from '../../utility/interceptors/limited-file.interceptor';
import { DepartmentGoalImportService } from '../service/department-goal-import.service';

const GOAL_IMPORT_MAX_BYTES =
  Number.parseInt(process.env.MAX_FILE_UPLOAD_BYTES ?? '', 10) ||
  5 * 1024 * 1024;

@RequiresModule('department_goals')
@UseGuards(AdminGuard, ModuleEnabledGuard)
@Controller(
  'department-goals/cycles/:cycleId/departments/:departmentId/bulk-import',
)
export class DepartmentGoalImportController {
  constructor(private readonly importService: DepartmentGoalImportService) {}

  @RequiresPermission(AdminPermission.DEPARTMENT_GOALS_WRITE)
  @Get('template')
  async downloadTemplate(@Res() res: Response) {
    const buffer = await this.importService.generateTemplate();
    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition':
        'attachment; filename="department-goals-import-template.xlsx"',
    });
    res.send(buffer);
  }

  @RequiresPermission(AdminPermission.DEPARTMENT_GOALS_WRITE)
  @Post('preview')
  @UseInterceptors(LimitedFileInterceptor('file', GOAL_IMPORT_MAX_BYTES))
  async preview(
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Param('departmentId', ParseUUIDPipe) departmentId: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.importService.previewImport(cycleId, departmentId, file, admin);
  }

  @RequiresPermission(AdminPermission.DEPARTMENT_GOALS_WRITE)
  @Get(':jobId')
  async getJob(@Param('jobId', ParseUUIDPipe) jobId: string) {
    const job = await this.importService.getJob(jobId);
    const rows = await this.importService.getJobRows(jobId);
    return { ...job, rows };
  }

  @RequiresPermission(AdminPermission.DEPARTMENT_GOALS_WRITE)
  @Post(':jobId/commit')
  async commit(
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.importService.commitImport(jobId, admin);
  }
}
