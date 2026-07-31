import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { CurrentAdmin } from '../../admin/decorator/current-admin.decorator';
import { Admin } from '../../admin/entity/admin.entity';
import { PlanGuard } from '../../billing/guard/plan.guard';
import { RequiresPlan } from '../../billing/decorator/requires-plan.decorator';
import { PlanFeature } from '../../billing/enum/plan-feature.enum';
import { AccountingPeriodService } from '../service/accounting-period.service';
import { CreateAccountingPeriodDto } from '../dto/accounting-period.dto';

@UseGuards(AdminGuard, PlanGuard)
@RequiresPlan(PlanFeature.FINANCE)
@Controller('admin/finance/accounting-periods')
export class AccountingPeriodController {
  constructor(private readonly periodService: AccountingPeriodService) {}

  @RequiresPermission(AdminPermission.FINANCE_WRITE)
  @Post()
  create(@Body() dto: CreateAccountingPeriodDto, @CurrentAdmin() admin: Admin) {
    return this.periodService.create(dto, admin);
  }

  @RequiresPermission(AdminPermission.FINANCE_READ)
  @Get()
  findAll() {
    return this.periodService.findAll();
  }

  @RequiresPermission(AdminPermission.FINANCE_READ)
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.periodService.findOne(id);
  }

  @RequiresPermission(AdminPermission.FINANCE_RECONCILE)
  @Patch(':id/close')
  close(@Param('id', ParseUUIDPipe) id: string, @CurrentAdmin() admin: Admin) {
    return this.periodService.close(id, admin);
  }

  @RequiresPermission(AdminPermission.FINANCE_RECONCILE)
  @Patch(':id/reopen')
  reopen(@Param('id', ParseUUIDPipe) id: string, @CurrentAdmin() admin: Admin) {
    return this.periodService.reopen(id, admin);
  }
}
