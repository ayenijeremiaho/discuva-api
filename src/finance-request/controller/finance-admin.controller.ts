import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { CurrentAdmin } from '../../admin/decorator/current-admin.decorator';
import { Admin } from '../../admin/entity/admin.entity';
import { FinanceRequestService } from '../service/finance-request.service';
import {
  AttachProofDto,
  CreateFinanceCategoryDto,
  RejectFinanceRequestDto,
  UpdateFinanceCategoryDto,
} from '../dto/finance-request.dto';
import { FinanceRequestStatus } from '../enum/finance-request.enum';
import { FinanceRequest } from '../entity/finance-request.entity';

@UseGuards(AdminGuard)
@Controller('admin/finance')
export class FinanceAdminController {
  constructor(private readonly financeRequestService: FinanceRequestService) {}

  // ── Categories ────────────────────────────────────────────────────────────

  @RequiresPermission(AdminPermission.FINANCE_READ)
  @Get('categories')
  getCategories() {
    return this.financeRequestService.getCategories();
  }

  @RequiresPermission(AdminPermission.FINANCE_WRITE)
  @Post('categories')
  createCategory(
    @Body() dto: CreateFinanceCategoryDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.financeRequestService.createCategory(dto, admin);
  }

  @RequiresPermission(AdminPermission.FINANCE_WRITE)
  @Patch('categories/:id')
  updateCategory(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFinanceCategoryDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.financeRequestService.updateCategory(id, dto, admin);
  }

  // ── Requests ──────────────────────────────────────────────────────────────

  @RequiresPermission(AdminPermission.FINANCE_READ)
  @Get('requests')
  getAllRequests(
    @Query('page') page = 1,
    @Query('limit') limit = 20,
    @Query('status') status?: FinanceRequestStatus,
    @Query('categoryId') categoryId?: string,
    @Query('memberId') memberId?: string,
    @Query('departmentId') departmentId?: string,
    @Query('search') search?: string,
  ) {
    return this.financeRequestService.getAllRequests(
      Number(page),
      Number(limit),
      status,
      categoryId,
      memberId,
      departmentId,
      search,
    );
  }

  @RequiresPermission(AdminPermission.FINANCE_READ)
  @Get('requests/download')
  async downloadRequests(
    @Res() res: Response,
    @Query('status') status?: FinanceRequestStatus,
    @Query('categoryId') categoryId?: string,
    @Query('memberId') memberId?: string,
    @Query('departmentId') departmentId?: string,
    @Query('search') search?: string,
  ): Promise<void> {
    const buffer = await this.financeRequestService.getRequestsExcel(
      status,
      categoryId,
      memberId,
      departmentId,
      search,
    );
    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="finance-requests.xlsx"',
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }

  @RequiresPermission(AdminPermission.FINANCE_READ)
  @Get('requests/:id')
  getRequest(@Param('id', ParseUUIDPipe) id: string) {
    return this.financeRequestService.getRequest(id);
  }

  @RequiresPermission(AdminPermission.FINANCE_WRITE)
  @Patch('requests/:id/approve')
  approveRequest(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAdmin() admin: Admin,
  ): Promise<FinanceRequest> {
    return this.financeRequestService.approveRequest(id, admin);
  }

  @RequiresPermission(AdminPermission.FINANCE_WRITE)
  @Patch('requests/:id/reject')
  rejectRequest(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectFinanceRequestDto,
    @CurrentAdmin() admin: Admin,
  ): Promise<FinanceRequest> {
    return this.financeRequestService.rejectRequest(id, dto, admin);
  }

  @RequiresPermission(AdminPermission.FINANCE_WRITE)
  @Patch('requests/:id/proof')
  @UseInterceptors(FileInterceptor('file'))
  attachProof(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: AttachProofDto,
    @CurrentAdmin() admin: Admin,
  ): Promise<FinanceRequest> {
    return this.financeRequestService.attachProof(id, file, dto, admin);
  }
}
