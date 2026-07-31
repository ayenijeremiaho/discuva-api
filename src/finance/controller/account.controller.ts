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
import { AccountService } from '../service/account.service';
import {
  AccountQueryDto,
  CreateAccountDto,
  UpdateAccountDto,
} from '../dto/account.dto';

@UseGuards(AdminGuard, PlanGuard)
@RequiresPlan(PlanFeature.FINANCE)
@Controller('admin/finance/accounts')
export class AccountController {
  constructor(private readonly accountService: AccountService) {}

  @RequiresPermission(AdminPermission.FINANCE_WRITE)
  @Post()
  create(@Body() dto: CreateAccountDto, @CurrentAdmin() admin: Admin) {
    return this.accountService.create(dto, admin);
  }

  @RequiresPermission(AdminPermission.FINANCE_READ)
  @Get()
  findAll(@Query() query: AccountQueryDto) {
    return this.accountService.findAll(query);
  }

  @RequiresPermission(AdminPermission.FINANCE_READ)
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.accountService.findOne(id);
  }

  @RequiresPermission(AdminPermission.FINANCE_WRITE)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAccountDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.accountService.update(id, dto, admin);
  }
}
