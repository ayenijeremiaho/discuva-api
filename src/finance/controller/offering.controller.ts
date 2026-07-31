import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
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
import { OfferingService } from '../service/offering.service';
import {
  CreateOfferingDto,
  OfferingQueryDto,
  ReconcileOfferingDto,
} from '../dto/offering.dto';

@UseGuards(AdminGuard, PlanGuard)
@RequiresPlan(PlanFeature.FINANCE)
@Controller('admin/finance/offerings')
export class OfferingController {
  constructor(private readonly offeringService: OfferingService) {}

  @RequiresPermission(AdminPermission.FINANCE_WRITE)
  @Post()
  create(@Body() dto: CreateOfferingDto, @CurrentAdmin() admin: Admin) {
    return this.offeringService.create(dto, admin);
  }

  @RequiresPermission(AdminPermission.FINANCE_READ)
  @Get()
  findAll(@Query() query: OfferingQueryDto) {
    return this.offeringService.findAll(query);
  }

  @RequiresPermission(AdminPermission.FINANCE_READ)
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.offeringService.findOne(id);
  }

  @RequiresPermission(AdminPermission.FINANCE_RECONCILE)
  @Patch(':id/reconcile')
  reconcile(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReconcileOfferingDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.offeringService.reconcile(id, dto, admin);
  }
}
