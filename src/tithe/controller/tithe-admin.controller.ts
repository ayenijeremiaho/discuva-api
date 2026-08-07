import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Response } from 'express';
import {
  TitheBatchStatus,
  TitheDisputeStatus,
  TitheProofStatus,
  TitheUnmatchedStatus,
} from '../enum/tithe.enum';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { CurrentAdmin } from '../../admin/decorator/current-admin.decorator';
import { Admin } from '../../admin/entity/admin.entity';
import { TitheService } from '../service/tithe.service';
import {
  CreateTitheAccountDto,
  DeclineTitheProofDto,
  MatchUnmatchedDto,
  UpdateTitheAccountDto,
} from '../dto/tithe.dto';
import { RequiresModule } from '../../church-settings/decorator/requires-module.decorator';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';

@RequiresModule('tithe')
@UseGuards(JwtAuthGuard, AdminGuard, ModuleEnabledGuard)
@Controller('admin/tithes')
export class TitheAdminController {
  constructor(private readonly titheService: TitheService) {}

  // ── Tithe Accounts ────────────────────────────────────────────────────────

  @RequiresPermission(AdminPermission.FINANCE_WRITE)
  @Post('accounts')
  createAccount(
    @Body() dto: CreateTitheAccountDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.titheService.createAccount(dto, admin);
  }

  @RequiresPermission(AdminPermission.FINANCE_READ)
  @Get('accounts')
  getAccounts() {
    return this.titheService.getAccounts();
  }

  @RequiresPermission(AdminPermission.FINANCE_WRITE)
  @Patch('accounts/:id')
  updateAccount(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTitheAccountDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.titheService.updateAccount(id, dto, admin);
  }

  @RequiresPermission(AdminPermission.FINANCE_READ)
  @Get('accounts/:id/summary')
  getAccountSummary(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('fromMonth') fromMonth?: string,
    @Query('toMonth') toMonth?: string,
  ) {
    return this.titheService.getAccountSummary(id, fromMonth, toMonth);
  }

  // ── Template & Upload ─────────────────────────────────────────────────────

  @RequiresPermission(AdminPermission.FINANCE_READ)
  @Get('template')
  async getTemplate(@Res() res: Response): Promise<void> {
    const buffer = await this.titheService.getTemplate();
    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition':
        'attachment; filename="tithe-upload-template.xlsx"',
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }

  @RequiresPermission(AdminPermission.FINANCE_WRITE)
  @Post('upload')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body('titheAccountId') titheAccountId: string,
    @CurrentAdmin() admin: Admin,
  ): Promise<{ batchId: string; totalRows: number; message: string }> {
    const result = await this.titheService.uploadBatch(
      file,
      admin,
      titheAccountId,
    );
    return { ...result, message: 'Upload queued for processing.' };
  }

  // ── Batches ───────────────────────────────────────────────────────────────

  @RequiresPermission(AdminPermission.FINANCE_READ)
  @Get('batches')
  getBatches(
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 20,
    @Query('status') status?: TitheBatchStatus,
  ) {
    return this.titheService.getBatches(page, limit, status);
  }

  @RequiresPermission(AdminPermission.FINANCE_READ)
  @Get('batches/:id')
  getBatch(@Param('id', ParseUUIDPipe) id: string) {
    return this.titheService.getBatch(id);
  }

  @RequiresPermission(AdminPermission.FINANCE_WRITE)
  @Post('batches/:id/requeue')
  @HttpCode(HttpStatus.NO_CONTENT)
  requeueBatch(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAdmin() admin: Admin,
  ): Promise<void> {
    return this.titheService.requeueBatch(id, admin);
  }

  // ── Unmatched ─────────────────────────────────────────────────────────────

  @RequiresPermission(AdminPermission.FINANCE_READ)
  @Get('unmatched')
  getUnmatched(
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 20,
    @Query('status') status?: TitheUnmatchedStatus,
    @Query('search') search?: string,
  ) {
    return this.titheService.getUnmatched(page, limit, status, search);
  }

  @RequiresPermission(AdminPermission.FINANCE_WRITE)
  @Post('unmatched/:id/match')
  @HttpCode(HttpStatus.NO_CONTENT)
  matchUnmatched(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MatchUnmatchedDto,
    @CurrentAdmin() admin: Admin,
  ): Promise<void> {
    return this.titheService.matchUnmatched(id, dto.memberId, admin);
  }

  @RequiresPermission(AdminPermission.FINANCE_WRITE)
  @Post('unmatched/:id/dismiss')
  @HttpCode(HttpStatus.NO_CONTENT)
  dismissUnmatched(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAdmin() admin: Admin,
  ): Promise<void> {
    return this.titheService.dismissUnmatched(id, admin);
  }

  // ── Disputes ──────────────────────────────────────────────────────────────

  @RequiresPermission(AdminPermission.FINANCE_READ)
  @Get('disputes')
  getDisputes(
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 20,
    @Query('status') status?: TitheDisputeStatus,
    @Query('search') search?: string,
  ) {
    return this.titheService.getDisputes(page, limit, status, search);
  }

  @RequiresPermission(AdminPermission.FINANCE_WRITE)
  @Post('disputes/:id/approve')
  @HttpCode(HttpStatus.NO_CONTENT)
  approveDispute(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAdmin() admin: Admin,
  ): Promise<void> {
    return this.titheService.approveDispute(id, admin);
  }

  @RequiresPermission(AdminPermission.FINANCE_WRITE)
  @Post('disputes/:id/reject')
  @HttpCode(HttpStatus.NO_CONTENT)
  rejectDispute(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAdmin() admin: Admin,
  ): Promise<void> {
    return this.titheService.rejectDispute(id, admin);
  }

  // ── Proofs ────────────────────────────────────────────────────────────────

  @RequiresPermission(AdminPermission.FINANCE_READ)
  @Get('proofs')
  getAllProofs(
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 20,
    @Query('status') status?: TitheProofStatus,
    @Query('search') search?: string,
  ) {
    return this.titheService.getAllProofs(page, limit, status, search);
  }

  @RequiresPermission(AdminPermission.FINANCE_WRITE)
  @Post('proofs/:id/confirm')
  @HttpCode(HttpStatus.NO_CONTENT)
  confirmProof(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAdmin() admin: Admin,
  ): Promise<void> {
    return this.titheService.confirmProof(id, admin);
  }

  @RequiresPermission(AdminPermission.FINANCE_WRITE)
  @Post('proofs/:id/decline')
  @HttpCode(HttpStatus.NO_CONTENT)
  declineProof(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeclineTitheProofDto,
    @CurrentAdmin() admin: Admin,
  ): Promise<void> {
    return this.titheService.declineProof(id, dto, admin);
  }

  // ── Records ───────────────────────────────────────────────────────────────

  @RequiresPermission(AdminPermission.FINANCE_READ)
  @Get('records')
  getRecords(
    @Query()
    q: {
      page?: string;
      limit?: string;
      memberId?: string;
      departmentId?: string;
      fromMonth?: string;
      toMonth?: string;
      search?: string;
      accountId?: string;
    },
  ) {
    const { memberId, departmentId, fromMonth, toMonth, search, accountId } = q;
    return this.titheService.getAdminRecords(
      Number(q.page) || 1,
      Number(q.limit) || 20,
      { memberId, departmentId, fromMonth, toMonth, search, accountId },
    );
  }

  @RequiresPermission(AdminPermission.FINANCE_READ)
  @Get('records/download')
  async downloadRecords(
    @Res() res: Response,
    @Query()
    q: {
      memberId?: string;
      departmentId?: string;
      fromMonth?: string;
      toMonth?: string;
      search?: string;
      accountId?: string;
    },
  ): Promise<void> {
    const buffer = await this.titheService.getAdminRecordsExcel(q);
    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="tithe-records.xlsx"',
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }
}
