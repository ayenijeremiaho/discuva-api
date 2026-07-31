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
import { FundService } from '../service/fund.service';
import { CreateFundDto, UpdateFundDto } from '../dto/fund.dto';

@UseGuards(AdminGuard, PlanGuard)
@RequiresPlan(PlanFeature.FINANCE)
@Controller('admin/finance/funds')
export class FundController {
  constructor(private readonly fundService: FundService) {}

  @RequiresPermission(AdminPermission.FINANCE_WRITE)
  @Post()
  create(@Body() dto: CreateFundDto, @CurrentAdmin() admin: Admin) {
    return this.fundService.create(dto, admin);
  }

  @RequiresPermission(AdminPermission.FINANCE_READ)
  @Get()
  findAll() {
    return this.fundService.findAll();
  }

  @RequiresPermission(AdminPermission.FINANCE_READ)
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.fundService.findOne(id);
  }

  @RequiresPermission(AdminPermission.FINANCE_WRITE)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFundDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.fundService.update(id, dto, admin);
  }
}
