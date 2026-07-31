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
import { PettyCashService } from '../service/petty-cash.service';
import {
  ApprovePettyCashDto,
  CreatePettyCashReplenishmentDto,
} from '../dto/petty-cash.dto';

@UseGuards(AdminGuard, PlanGuard)
@RequiresPlan(PlanFeature.FINANCE)
@Controller('admin/finance/petty-cash')
export class PettyCashController {
  constructor(private readonly pettyCashService: PettyCashService) {}

  @RequiresPermission(AdminPermission.FINANCE_WRITE)
  @Post()
  create(
    @Body() dto: CreatePettyCashReplenishmentDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.pettyCashService.create(dto, admin);
  }

  @RequiresPermission(AdminPermission.FINANCE_READ)
  @Get()
  findAll(
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 20,
  ) {
    return this.pettyCashService.findAll(page, limit);
  }

  @RequiresPermission(AdminPermission.FINANCE_READ)
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.pettyCashService.findOne(id);
  }

  @RequiresPermission(AdminPermission.FINANCE_APPROVE)
  @Patch(':id/reject')
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApprovePettyCashDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.pettyCashService.reject(id, dto.notes, admin);
  }

  @RequiresPermission(AdminPermission.FINANCE_APPROVE)
  @Patch(':id/approve')
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApprovePettyCashDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.pettyCashService.approve(id, dto, admin);
  }
}
