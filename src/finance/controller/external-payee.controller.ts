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
import { ExternalPayeeService } from '../service/external-payee.service';
import {
  CreateExternalPayeeDto,
  UpdateExternalPayeeDto,
} from '../dto/external-payee.dto';

@UseGuards(AdminGuard, PlanGuard)
@RequiresPlan(PlanFeature.FINANCE)
@Controller('admin/finance/external-payees')
export class ExternalPayeeController {
  constructor(private readonly payeeService: ExternalPayeeService) {}

  @RequiresPermission(AdminPermission.FINANCE_WRITE)
  @Post()
  create(@Body() dto: CreateExternalPayeeDto, @CurrentAdmin() admin: Admin) {
    return this.payeeService.create(dto, admin);
  }

  @RequiresPermission(AdminPermission.FINANCE_READ)
  @Get()
  findAll() {
    return this.payeeService.findAll();
  }

  @RequiresPermission(AdminPermission.FINANCE_READ)
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.payeeService.findOne(id);
  }

  @RequiresPermission(AdminPermission.FINANCE_WRITE)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateExternalPayeeDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.payeeService.update(id, dto, admin);
  }
}
