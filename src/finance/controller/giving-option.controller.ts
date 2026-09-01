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
import { GivingOptionService } from '../service/giving-option.service';
import {
  CreateGivingOptionDto,
  UpdateGivingOptionDto,
} from '../dto/giving-option.dto';

@UseGuards(AdminGuard, PlanGuard)
@RequiresPlan(PlanFeature.FINANCE)
@Controller('admin/finance/giving-options')
export class GivingOptionController {
  constructor(private readonly givingOptionService: GivingOptionService) {}

  @RequiresPermission(AdminPermission.FINANCE_WRITE)
  @Post()
  create(@Body() dto: CreateGivingOptionDto, @CurrentAdmin() admin: Admin) {
    return this.givingOptionService.create(dto, admin);
  }

  @RequiresPermission(AdminPermission.FINANCE_READ)
  @Get()
  findAll() {
    return this.givingOptionService.findAll();
  }

  @RequiresPermission(AdminPermission.FINANCE_READ)
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.givingOptionService.findOne(id);
  }

  @RequiresPermission(AdminPermission.FINANCE_WRITE)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGivingOptionDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.givingOptionService.update(id, dto, admin);
  }
}
