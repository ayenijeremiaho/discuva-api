import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { CurrentAdmin } from '../../admin/decorator/current-admin.decorator';
import { Admin } from '../../admin/entity/admin.entity';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { NetworkReportService } from '../service/network-report.service';
import { NetworkSettingsService } from '../service/network-settings.service';
import { NetworkSettingsDto, ReportQueryDto } from '../dto/network.dto';

@UseGuards(AdminGuard)
@Controller('network')
export class NetworkReportController {
  constructor(
    private readonly reports: NetworkReportService,
    private readonly settings: NetworkSettingsService,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  // This month by default: the overview. Any of the last 12 months for the report.
  @RequiresPermission(AdminPermission.BRANCH_READ)
  @Get('report')
  report(@Query() q: ReportQueryDto) {
    return this.reports.report(q.month);
  }

  @RequiresPermission(AdminPermission.BRANCH_READ)
  @Get('settings')
  async getSettings() {
    return this.settings.view((await this.here()).networkRootId!);
  }

  @RequiresPermission(AdminPermission.BRANCH_WRITE)
  @Put('settings')
  async updateSettings(
    @CurrentAdmin() admin: Admin,
    @Body() dto: NetworkSettingsDto,
  ) {
    const here = await this.here();
    return this.settings.update(
      here.networkRootId!,
      admin.isOwner && here.id === here.networkRootId,
      dto,
    );
  }

  private async here(): Promise<Tenant> {
    const here = await this.tenantRepo.findOne({
      where: { id: this.cls.get('tenantId') },
      select: { id: true, networkRootId: true },
    });
    if (!here?.networkRootId)
      throw new NotFoundException('Your church is not part of a network.');
    return here;
  }
}
