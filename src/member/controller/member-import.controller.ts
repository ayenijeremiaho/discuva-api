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
import { MemberImportService } from '../service/member-import.service';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { CurrentAdmin } from '../../admin/decorator/current-admin.decorator';
import { Admin } from '../../admin/entity/admin.entity';
import { LimitedFileInterceptor } from '../../utility/interceptors/limited-file.interceptor';

const MEMBER_IMPORT_MAX_BYTES =
  Number.parseInt(process.env.MAX_FILE_UPLOAD_BYTES ?? '', 10) ||
  5 * 1024 * 1024;

@UseGuards(AdminGuard)
@Controller('members/bulk-import')
export class MemberImportController {
  constructor(private readonly memberImportService: MemberImportService) {}

  @RequiresPermission(AdminPermission.MEMBERS_WRITE)
  @Get('template')
  async downloadTemplate(@Res() res: Response) {
    const buffer = await this.memberImportService.generateTemplate();
    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition':
        'attachment; filename="member-import-template.xlsx"',
    });
    res.send(buffer);
  }

  @RequiresPermission(AdminPermission.MEMBERS_WRITE)
  @Post('preview')
  @UseInterceptors(LimitedFileInterceptor('file', MEMBER_IMPORT_MAX_BYTES))
  async preview(
    @UploadedFile() file: Express.Multer.File,
    @CurrentAdmin() admin: Admin,
  ) {
    const job = await this.memberImportService.previewImport(file, admin);
    const rows = await this.memberImportService.getJobRows(job.id);
    return { ...job, rows };
  }

  @RequiresPermission(AdminPermission.MEMBERS_WRITE)
  @Get(':jobId')
  async getJob(@Param('jobId', ParseUUIDPipe) jobId: string) {
    const job = await this.memberImportService.getJob(jobId);
    const rows = await this.memberImportService.getJobRows(jobId);
    return { ...job, rows };
  }

  @RequiresPermission(AdminPermission.MEMBERS_WRITE)
  @Post(':jobId/commit')
  async commit(
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.memberImportService.commitImport(jobId, admin);
  }
}
