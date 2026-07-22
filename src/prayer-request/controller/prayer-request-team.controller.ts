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
import { PrayerRequestService } from '../service/prayer-request.service';
import {
  UpdatePrayerRequestStatusDto,
  CreatePregnancyCaseDto,
  LogPregnancyVisitDto,
  UpdatePregnancyCaseStatusDto,
} from '../dto/prayer-request.dto';
import { PrayerRequestStatusEnum } from '../enum/prayer-request-status.enum';
import { PregnancyCaseStatusEnum } from '../enum/pregnancy-case-status.enum';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorator/current-user.decorator';
import { MemberAuth } from '../../auth/interface/auth.interface';

@UseGuards(JwtAuthGuard)
@Controller()
export class PrayerRequestTeamController {
  constructor(private readonly prayerRequestService: PrayerRequestService) {}

  @Get('prayer-requests/team')
  async getAll(
    @CurrentUser() user: MemberAuth,
    @Query('status') status?: PrayerRequestStatusEnum,
    @Query('page') page = 1,
    @Query('limit') limit = 10,
  ) {
    await this.prayerRequestService.assertIsPrayerTeamOrPastor(user.id);
    return this.prayerRequestService.getAllRequestsForTeam(
      Number(page),
      Number(limit),
      status,
    );
  }

  @Patch('prayer-requests/team/:id/status')
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePrayerRequestStatusDto,
    @CurrentUser() user: MemberAuth,
  ) {
    await this.prayerRequestService.assertIsPrayerTeamOrPastor(user.id);
    return this.prayerRequestService.updateStatus(id, dto, user.id);
  }

  @Get('prayer-requests/team/pregnancy-cases')
  async getPregnancyCases(
    @CurrentUser() user: MemberAuth,
    @Query('status') status?: PregnancyCaseStatusEnum,
    @Query('page') page = 1,
    @Query('limit') limit = 10,
  ) {
    await this.prayerRequestService.assertIsPrayerTeamOrPastor(user.id);
    return this.prayerRequestService.getPregnancyCases(
      Number(page),
      Number(limit),
      status,
    );
  }

  @Post('prayer-requests/team/pregnancy-cases')
  async createPregnancyCase(
    @Body() dto: CreatePregnancyCaseDto,
    @CurrentUser() user: MemberAuth,
  ) {
    await this.prayerRequestService.assertIsPrayerTeamOrPastor(user.id);
    return this.prayerRequestService.createPregnancyCase(dto, user);
  }

  @Post('prayer-requests/team/pregnancy-cases/:id/visit')
  async logPregnancyVisit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LogPregnancyVisitDto,
    @CurrentUser() user: MemberAuth,
  ) {
    await this.prayerRequestService.assertIsPrayerTeamOrPastor(user.id);
    return this.prayerRequestService.logPregnancyVisit(id, dto, user);
  }

  @Patch('prayer-requests/team/pregnancy-cases/:id/status')
  async updatePregnancyCaseStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePregnancyCaseStatusDto,
    @CurrentUser() user: MemberAuth,
  ) {
    await this.prayerRequestService.assertIsPrayerTeamOrPastor(user.id);
    return this.prayerRequestService.updatePregnancyCaseStatus(
      id,
      dto,
      user.id,
    );
  }

  @Get('prayer-requests/team/pregnancy-cases/:id/visits')
  async getPregnancyVisitHistory(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: MemberAuth,
    @Query('page') page = 1,
    @Query('limit') limit = 10,
  ) {
    await this.prayerRequestService.assertIsPrayerTeamOrPastor(user.id);
    return this.prayerRequestService.getPregnancyVisitHistory(
      id,
      Number(page),
      Number(limit),
    );
  }
}
