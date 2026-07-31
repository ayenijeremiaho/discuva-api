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
import { PledgeService } from '../service/pledge.service';
import {
  CreatePledgeCampaignDto,
  CreatePledgeDto,
  PledgeQueryDto,
  UpdateCampaignActiveDto,
  UpdatePledgeStatusDto,
} from '../dto/pledge.dto';
import {
  DeclinePledgeContributionDto,
  PledgeContributionQueryDto,
} from '../dto/pledge-contribution.dto';

@UseGuards(AdminGuard, PlanGuard)
@RequiresPlan(PlanFeature.FINANCE)
@Controller('admin/finance/pledges')
export class PledgeController {
  constructor(private readonly pledgeService: PledgeService) {}

  @RequiresPermission(AdminPermission.FINANCE_WRITE)
  @Post('campaigns')
  createCampaign(
    @Body() dto: CreatePledgeCampaignDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.pledgeService.createCampaign(dto, admin);
  }

  @RequiresPermission(AdminPermission.FINANCE_READ)
  @Get('campaigns')
  findAllCampaigns() {
    return this.pledgeService.findAllCampaigns();
  }

  @RequiresPermission(AdminPermission.FINANCE_READ)
  @Get('campaigns/:id')
  findOneCampaign(@Param('id', ParseUUIDPipe) id: string) {
    return this.pledgeService.findOneCampaign(id);
  }

  @RequiresPermission(AdminPermission.FINANCE_WRITE)
  @Patch('campaigns/:id/active')
  updateCampaignActive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCampaignActiveDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.pledgeService.updateCampaignActive(id, dto, admin);
  }

  @RequiresPermission(AdminPermission.FINANCE_WRITE)
  @Post()
  createPledge(@Body() dto: CreatePledgeDto, @CurrentAdmin() admin: Admin) {
    return this.pledgeService.createPledge(dto, admin);
  }

  @RequiresPermission(AdminPermission.FINANCE_READ)
  @Get()
  findPledges(@Query() query: PledgeQueryDto) {
    return this.pledgeService.findPledges(query);
  }

  @RequiresPermission(AdminPermission.FINANCE_WRITE)
  @Patch(':id/status')
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePledgeStatusDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.pledgeService.updatePledgeStatus(id, dto, admin);
  }

  @RequiresPermission(AdminPermission.FINANCE_READ)
  @Get('contributions')
  findContributions(@Query() query: PledgeContributionQueryDto) {
    return this.pledgeService.findContributions(query);
  }

  @RequiresPermission(AdminPermission.FINANCE_WRITE)
  @Post('contributions/:id/confirm')
  confirmContribution(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.pledgeService.confirmContribution(id, admin);
  }

  @RequiresPermission(AdminPermission.FINANCE_WRITE)
  @Post('contributions/:id/decline')
  declineContribution(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeclinePledgeContributionDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.pledgeService.declineContribution(id, dto, admin);
  }
}
