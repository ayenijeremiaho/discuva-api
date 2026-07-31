import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { CurrentAdmin } from '../../admin/decorator/current-admin.decorator';
import { Admin } from '../../admin/entity/admin.entity';
import { PlanGuard } from '../../billing/guard/plan.guard';
import { RequiresPlan } from '../../billing/decorator/requires-plan.decorator';
import { PlanFeature } from '../../billing/enum/plan-feature.enum';
import { ReconciliationService } from '../service/reconciliation.service';
import {
  BulkConfirmReconciliationDto,
  ConfirmReconciliationRowDto,
  PostConfirmedRowsDto,
  ReconciliationRowQueryDto,
  SkipReconciliationRowDto,
} from '../dto/reconciliation.dto';

@UseGuards(AdminGuard, PlanGuard)
@RequiresPlan(PlanFeature.FINANCE)
@Controller('admin/finance/reconciliation')
export class ReconciliationController {
  constructor(private readonly reconciliationService: ReconciliationService) {}

  @RequiresPermission(AdminPermission.FINANCE_RECONCILE)
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  uploadCsv(
    @UploadedFile() file: Express.Multer.File,
    @CurrentAdmin() admin: Admin,
    @Query('profileId') profileId?: string,
  ) {
    return this.reconciliationService.uploadCsv(file, admin, profileId);
  }

  @RequiresPermission(AdminPermission.FINANCE_RECONCILE)
  @Get('jobs')
  findAllJobs(
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 20,
  ) {
    return this.reconciliationService.findAllJobs(page, limit);
  }

  @RequiresPermission(AdminPermission.FINANCE_RECONCILE)
  @Get('jobs/:id')
  findJob(@Param('id', ParseUUIDPipe) id: string) {
    return this.reconciliationService.findJob(id);
  }

  @RequiresPermission(AdminPermission.FINANCE_RECONCILE)
  @Get('jobs/:id/rows')
  findRows(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ReconciliationRowQueryDto,
  ) {
    return this.reconciliationService.findRows(id, query);
  }

  @RequiresPermission(AdminPermission.FINANCE_RECONCILE)
  @Patch('jobs/:jobId/rows/:rowId/confirm')
  confirmRow(
    @Param('rowId', ParseUUIDPipe) rowId: string,
    @Body() dto: ConfirmReconciliationRowDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.reconciliationService.confirmRow(rowId, dto, admin);
  }

  @RequiresPermission(AdminPermission.FINANCE_RECONCILE)
  @Post('jobs/:id/bulk-confirm')
  bulkConfirm(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BulkConfirmReconciliationDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.reconciliationService.bulkConfirm(id, dto, admin);
  }

  @RequiresPermission(AdminPermission.FINANCE_RECONCILE)
  @Patch('jobs/:jobId/rows/:rowId/skip')
  skipRow(
    @Param('rowId', ParseUUIDPipe) rowId: string,
    @Body() dto: SkipReconciliationRowDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.reconciliationService.skipRow(rowId, dto, admin);
  }

  @RequiresPermission(AdminPermission.FINANCE_RECONCILE)
  @Post('jobs/:id/post-confirmed')
  postConfirmedRows(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PostConfirmedRowsDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.reconciliationService.postConfirmedRows(id, dto, admin);
  }
}
