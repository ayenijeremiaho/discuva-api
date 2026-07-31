import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { CurrentAdmin } from '../../admin/decorator/current-admin.decorator';
import { Admin } from '../../admin/entity/admin.entity';
import { PlanGuard } from '../../billing/guard/plan.guard';
import { RequiresPlan } from '../../billing/decorator/requires-plan.decorator';
import { PlanFeature } from '../../billing/enum/plan-feature.enum';
import { BankImportProfileService } from '../service/bank-import-profile.service';
import {
  CreateBankImportProfileDto,
  UpdateBankImportProfileDto,
} from '../dto/bank-import-profile.dto';

@UseGuards(AdminGuard, PlanGuard)
@RequiresPermission(AdminPermission.FINANCE_RECONCILE)
@RequiresPlan(PlanFeature.FINANCE)
@Controller('admin/finance/bank-import-profiles')
export class BankImportProfileController {
  constructor(private readonly profileService: BankImportProfileService) {}

  @Post()
  create(
    @Body() dto: CreateBankImportProfileDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.profileService.create(dto, admin);
  }

  @Get()
  findAll() {
    return this.profileService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.profileService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBankImportProfileDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.profileService.update(id, dto, admin);
  }

  @Get(':id/template')
  async downloadTemplate(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const { filename, content } =
      await this.profileService.downloadTemplate(id);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(content);
  }
}
