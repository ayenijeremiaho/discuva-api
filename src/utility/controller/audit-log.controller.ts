import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { PlanGuard } from '../../billing/guard/plan.guard';
import { RequiresPlan } from '../../billing/decorator/requires-plan.decorator';
import { PlanFeature } from '../../billing/enum/plan-feature.enum';
import { AuditLogService } from '../service/audit-log.service';
import { PaginationResponseDto } from '../dto/pagination-response.dto';
import { AuditLog } from '../entity/audit-log.entity';
import { AuditLogQueryDto } from '../dto/audit-log-query.dto';

@UseGuards(AdminGuard, PlanGuard)
@RequiresPermission(AdminPermission.AUDIT_READ)
@RequiresPlan(PlanFeature.AUDIT)
@Controller('admin/audit-logs')
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get()
  async getAll(
    @Query() query: AuditLogQueryDto,
  ): Promise<PaginationResponseDto<AuditLog>> {
    const {
      page = 1,
      limit = 20,
      action,
      actorId,
      targetId,
      targetEmail,
      dateFrom,
      dateTo,
    } = query;
    return this.auditLogService.findAll(page, limit, {
      action,
      actorId,
      targetId,
      targetEmail,
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
    });
  }
}
