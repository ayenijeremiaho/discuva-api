import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { GivingService } from '../service/giving.service';
import { PledgeService } from '../service/pledge.service';
import { AnnualGivingStatementScheduler } from '../scheduler/annual-giving-statement.scheduler';
import { MakePledgeDto } from '../dto/pledge.dto';
import { SubmitPledgeContributionDto } from '../dto/pledge-contribution.dto';

@UseGuards(JwtAuthGuard)
@Controller('finance')
export class FinanceMemberController {
  constructor(
    private readonly givingService: GivingService,
    private readonly pledgeService: PledgeService,
    private readonly annualGivingStatementScheduler: AnnualGivingStatementScheduler,
  ) {}

  @Get('me/giving-summary')
  getGivingSummary(@Request() req: any) {
    return this.givingService.getMemberGivingSummary(req.user.id);
  }

  @Get('pledge-campaigns')
  getActivePledgeCampaigns() {
    return this.pledgeService.findActiveCampaignsForMembers();
  }

  @Post('me/pledges')
  makePledge(@Request() req: any, @Body() dto: MakePledgeDto) {
    return this.pledgeService.memberMakePledge(req.user.id, dto);
  }

  @Get('me/pledges')
  getMyPledges(@Request() req: any) {
    return this.pledgeService.getMemberPledges(req.user.id);
  }

  @Post('me/pledges/:id/contributions')
  submitContribution(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitPledgeContributionDto,
  ) {
    return this.pledgeService.submitContribution(req.user.id, id, dto);
  }

  @Get('me/pledges/:id/contributions')
  getMyContributions(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.pledgeService.getMyContributions(req.user.id, id);
  }

  @Post('me/giving-statement/send')
  requestGivingStatement(@Request() req: any) {
    return this.annualGivingStatementScheduler.sendForMember(req.user.id);
  }
}
