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
import { RecurringEntryService } from '../service/recurring-entry.service';
import {
  CreateRecurringEntryDto,
  UpdateRecurringEntryDto,
} from '../dto/recurring-entry.dto';

@UseGuards(AdminGuard, PlanGuard)
@RequiresPlan(PlanFeature.FINANCE)
@Controller('admin/finance/recurring-entries')
export class RecurringEntryController {
  constructor(private readonly recurringService: RecurringEntryService) {}

  @RequiresPermission(AdminPermission.FINANCE_WRITE)
  @Post()
  create(@Body() dto: CreateRecurringEntryDto, @CurrentAdmin() admin: Admin) {
    return this.recurringService.create(dto, admin);
  }

  @RequiresPermission(AdminPermission.FINANCE_READ)
  @Get()
  findAll() {
    return this.recurringService.findAll();
  }

  @RequiresPermission(AdminPermission.FINANCE_READ)
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.recurringService.findOne(id);
  }

  @RequiresPermission(AdminPermission.FINANCE_WRITE)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRecurringEntryDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.recurringService.update(id, dto, admin);
  }
}
