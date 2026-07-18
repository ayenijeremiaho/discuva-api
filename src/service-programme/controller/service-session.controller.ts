import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { RolesGuard } from '../../auth/guard/roles.guard';
import { Roles } from '../../auth/decorator/roles.decorator';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { Public } from '../../auth/decorator/public.decorator';
import { CurrentUser } from '../../auth/decorator/current-user.decorator';
import { MemberAuth } from '../../auth/interface/auth.interface';
import { MemberRoleEnum } from '../../member/enums/member-role.enum';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { ServiceSessionService } from '../service/service-session.service';
import { ServiceSessionGateway } from '../gateway/service-session.gateway';
import { ShareTokenGuard } from '../guard/share-token.guard';
import { NamedAccessGuard } from '../guard/named-access.guard';
import { ActorLabel } from '../decorator/actor-label.decorator';
import { PauseSessionDto } from '../dto/pause-session.dto';
import { RuntimeOverrideDto } from '../dto/runtime-override.dto';
import { AdjustSessionTimeDto } from '../dto/adjust-session-time.dto';
import { ReorderLiveSlotsDto } from '../dto/reorder-live-slots.dto';
import { CreateAccessGrantDto } from '../dto/create-access-grant.dto';
import { VerifyAccessGrantDto } from '../dto/verify-access-grant.dto';

@Controller('service-session')
export class ServiceSessionController {
  constructor(
    private readonly sessionSvc: ServiceSessionService,
    private readonly gateway: ServiceSessionGateway,
  ) {}

  @Post('programme/:programmeId/start')
  @UseGuards(JwtAuthGuard)
  async start(
    @Param('programmeId', ParseUUIDPipe) programmeId: string,
    @CurrentUser() user: MemberAuth,
  ) {
    const session = await this.sessionSvc.start(programmeId, user.id);
    const state = await this.sessionSvc.getState(session.sessionCode);
    this.gateway.broadcastState(session.sessionCode, state);
    return session;
  }

  @Post('event/:eventId/start')
  @UseGuards(JwtAuthGuard)
  async startEvent(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @CurrentUser() user: MemberAuth,
  ) {
    const sessions = await this.sessionSvc.startEvent(eventId, user.id);
    for (const session of sessions) {
      this.gateway.broadcastState(
        session.sessionCode,
        await this.sessionSvc.getState(session.sessionCode),
      );
    }
    return sessions;
  }

  @Post(':sessionCode/advance')
  @UseGuards(JwtAuthGuard)
  async advance(
    @Param('sessionCode') sessionCode: string,
    @CurrentUser() user: MemberAuth,
  ) {
    const anchor = await this.sessionSvc.advance(sessionCode, user.id);
    this.gateway.broadcastState(
      sessionCode,
      await this.sessionSvc.getState(sessionCode),
    );
    return anchor;
  }

  @Post(':sessionCode/rewind')
  @UseGuards(JwtAuthGuard)
  async rewind(
    @Param('sessionCode') sessionCode: string,
    @CurrentUser() user: MemberAuth,
  ) {
    const anchor = await this.sessionSvc.rewind(sessionCode, user.id);
    this.gateway.broadcastState(
      sessionCode,
      await this.sessionSvc.getState(sessionCode),
    );
    return anchor;
  }

  @Post(':sessionCode/pause')
  @UseGuards(JwtAuthGuard)
  async pause(
    @Param('sessionCode') sessionCode: string,
    @Body() dto: PauseSessionDto,
    @CurrentUser() user: MemberAuth,
  ) {
    const anchor = await this.sessionSvc.pause(sessionCode, dto, user.id);
    this.gateway.broadcastState(
      sessionCode,
      await this.sessionSvc.getState(sessionCode),
    );
    return anchor;
  }

  @Post(':sessionCode/resume')
  @UseGuards(JwtAuthGuard)
  async resume(
    @Param('sessionCode') sessionCode: string,
    @CurrentUser() user: MemberAuth,
  ) {
    const anchor = await this.sessionSvc.resume(sessionCode, user.id);
    this.gateway.broadcastState(
      sessionCode,
      await this.sessionSvc.getState(sessionCode),
    );
    return anchor;
  }

  @Post(':sessionCode/adjust-time')
  @UseGuards(JwtAuthGuard)
  async adjustTime(
    @Param('sessionCode') sessionCode: string,
    @Body() dto: AdjustSessionTimeDto,
    @CurrentUser() user: MemberAuth,
  ) {
    const anchor = await this.sessionSvc.adjustTime(
      sessionCode,
      dto.deltaSeconds,
      user.id,
    );
    this.gateway.broadcastState(
      sessionCode,
      await this.sessionSvc.getState(sessionCode),
    );
    return anchor;
  }

  @Put(':sessionCode/slots/reorder')
  @UseGuards(JwtAuthGuard)
  async reorderLiveSlots(
    @Param('sessionCode') sessionCode: string,
    @Body() dto: ReorderLiveSlotsDto,
    @CurrentUser() user: MemberAuth,
  ) {
    const slots = await this.sessionSvc.reorderLiveSlots(
      sessionCode,
      dto.slots.map((s) => s.id),
      user.id,
    );
    this.gateway.broadcastState(
      sessionCode,
      await this.sessionSvc.getState(sessionCode),
    );
    return slots;
  }

  @Post(':sessionCode/slots/:position/override')
  @UseGuards(RolesGuard)
  @Roles(MemberRoleEnum.WORKER)
  async overrideSlot(
    @Param('sessionCode') sessionCode: string,
    @Param('position', ParseIntPipe) position: number,
    @Body() dto: RuntimeOverrideDto,
    @CurrentUser() user: MemberAuth,
  ) {
    const slot = await this.sessionSvc.overrideSlot(
      sessionCode,
      position,
      dto,
      user.id,
    );
    this.gateway.broadcastState(
      sessionCode,
      await this.sessionSvc.getState(sessionCode),
    );
    return slot;
  }

  @Post(':sessionCode/end')
  @UseGuards(JwtAuthGuard)
  async end(
    @Param('sessionCode') sessionCode: string,
    @CurrentUser() user: MemberAuth,
  ) {
    const session = await this.sessionSvc.end(sessionCode, user.id);
    this.gateway.broadcastState(
      sessionCode,
      await this.sessionSvc.getState(sessionCode),
    );
    return session;
  }

  // ── Public Programme Manager routes — gated by the share token (has the
  // link) plus a named, individually-revocable access grant (who they are) ──

  @Post(':sessionCode/pm/access')
  @Public()
  @UseGuards(ShareTokenGuard)
  verifyAccess(
    @Param('sessionCode') sessionCode: string,
    @Body() dto: VerifyAccessGrantDto,
  ) {
    return this.sessionSvc.verifyAccessGrant(sessionCode, dto.name, dto.pin);
  }

  @Post(':sessionCode/pm/advance')
  @Public()
  @UseGuards(ShareTokenGuard, NamedAccessGuard)
  async pmAdvance(
    @Param('sessionCode') sessionCode: string,
    @ActorLabel() actorLabel: string | null,
  ) {
    const anchor = await this.sessionSvc.advance(sessionCode, null, actorLabel);
    this.gateway.broadcastState(
      sessionCode,
      await this.sessionSvc.getState(sessionCode),
    );
    return anchor;
  }

  @Post(':sessionCode/pm/rewind')
  @Public()
  @UseGuards(ShareTokenGuard, NamedAccessGuard)
  async pmRewind(
    @Param('sessionCode') sessionCode: string,
    @ActorLabel() actorLabel: string | null,
  ) {
    const anchor = await this.sessionSvc.rewind(sessionCode, null, actorLabel);
    this.gateway.broadcastState(
      sessionCode,
      await this.sessionSvc.getState(sessionCode),
    );
    return anchor;
  }

  @Post(':sessionCode/pm/pause')
  @Public()
  @UseGuards(ShareTokenGuard, NamedAccessGuard)
  async pmPause(
    @Param('sessionCode') sessionCode: string,
    @Body() dto: PauseSessionDto,
    @ActorLabel() actorLabel: string | null,
  ) {
    const anchor = await this.sessionSvc.pause(
      sessionCode,
      dto,
      null,
      actorLabel,
    );
    this.gateway.broadcastState(
      sessionCode,
      await this.sessionSvc.getState(sessionCode),
    );
    return anchor;
  }

  @Post(':sessionCode/pm/resume')
  @Public()
  @UseGuards(ShareTokenGuard, NamedAccessGuard)
  async pmResume(
    @Param('sessionCode') sessionCode: string,
    @ActorLabel() actorLabel: string | null,
  ) {
    const anchor = await this.sessionSvc.resume(sessionCode, null, actorLabel);
    this.gateway.broadcastState(
      sessionCode,
      await this.sessionSvc.getState(sessionCode),
    );
    return anchor;
  }

  @Post(':sessionCode/pm/adjust-time')
  @Public()
  @UseGuards(ShareTokenGuard, NamedAccessGuard)
  async pmAdjustTime(
    @Param('sessionCode') sessionCode: string,
    @Body() dto: AdjustSessionTimeDto,
    @ActorLabel() actorLabel: string | null,
  ) {
    const anchor = await this.sessionSvc.adjustTime(
      sessionCode,
      dto.deltaSeconds,
      null,
      actorLabel,
    );
    this.gateway.broadcastState(
      sessionCode,
      await this.sessionSvc.getState(sessionCode),
    );
    return anchor;
  }

  @Put(':sessionCode/pm/slots/reorder')
  @Public()
  @UseGuards(ShareTokenGuard, NamedAccessGuard)
  async pmReorderLiveSlots(
    @Param('sessionCode') sessionCode: string,
    @Body() dto: ReorderLiveSlotsDto,
    @ActorLabel() actorLabel: string | null,
  ) {
    const slots = await this.sessionSvc.reorderLiveSlots(
      sessionCode,
      dto.slots.map((s) => s.id),
      null,
      actorLabel,
    );
    this.gateway.broadcastState(
      sessionCode,
      await this.sessionSvc.getState(sessionCode),
    );
    return slots;
  }

  @Post(':sessionCode/pm/end')
  @Public()
  @UseGuards(ShareTokenGuard, NamedAccessGuard)
  async pmEnd(
    @Param('sessionCode') sessionCode: string,
    @ActorLabel() actorLabel: string | null,
  ) {
    const session = await this.sessionSvc.end(sessionCode, null, actorLabel);
    this.gateway.broadcastState(
      sessionCode,
      await this.sessionSvc.getState(sessionCode),
    );
    return session;
  }

  @Post(':sessionCode/pm/slots/:position/override')
  @Public()
  @UseGuards(ShareTokenGuard, NamedAccessGuard)
  async pmOverrideSlot(
    @Param('sessionCode') sessionCode: string,
    @Param('position', ParseIntPipe) position: number,
    @Body() dto: RuntimeOverrideDto,
    @ActorLabel() actorLabel: string | null,
  ) {
    const slot = await this.sessionSvc.overrideSlot(
      sessionCode,
      position,
      dto,
      null,
      actorLabel,
    );
    this.gateway.broadcastState(
      sessionCode,
      await this.sessionSvc.getState(sessionCode),
    );
    return slot;
  }

  @Get('active')
  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.SERVICE_PROGRAMME_READ)
  getActiveSessions() {
    return this.sessionSvc.getActiveSessions();
  }

  @Get('analytics')
  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.SERVICE_PROGRAMME_READ)
  getAnalytics(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('serviceSlotName') serviceSlotName?: string,
    @Query('memberId') memberId?: string,
    @Query('slotType') slotType?: string,
  ) {
    return this.sessionSvc.getAnalytics(
      from,
      to,
      serviceSlotName,
      memberId,
      slotType,
    );
  }

  @Get('my-history')
  @UseGuards(JwtAuthGuard)
  getMyServiceHistory(
    @CurrentUser() user: MemberAuth,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.sessionSvc.getMyServiceHistory(
      user.id,
      page ? +page : undefined,
      limit ? +limit : undefined,
    );
  }

  @Get(':sessionCode/state')
  @Public()
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  getState(@Param('sessionCode') sessionCode: string) {
    return this.sessionSvc.getState(sessionCode);
  }

  @Get(':sessionCode/slots/:position')
  @Public()
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  getSlotForSpeaker(
    @Param('sessionCode') sessionCode: string,
    @Param('position', ParseIntPipe) position: number,
  ) {
    return this.sessionSvc.getSlotForSpeaker(sessionCode, position);
  }

  @Get(':sessionCode/my-status')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  getMyLiveStatus(
    @Param('sessionCode') sessionCode: string,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.sessionSvc.getMyLiveStatus(sessionCode, user.id);
  }

  @Get(':sessionCode/share-links')
  @UseGuards(JwtAuthGuard)
  getShareLinks(
    @Param('sessionCode') sessionCode: string,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.sessionSvc.getShareLinks(sessionCode, user.id);
  }

  @Post(':sessionCode/rotate-share-token')
  @UseGuards(JwtAuthGuard)
  rotateShareToken(
    @Param('sessionCode') sessionCode: string,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.sessionSvc.rotateShareToken(sessionCode, user.id);
  }

  @Post(':sessionCode/access-grants')
  @UseGuards(JwtAuthGuard)
  createAccessGrant(
    @Param('sessionCode') sessionCode: string,
    @Body() dto: CreateAccessGrantDto,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.sessionSvc.generateAccessGrant(
      sessionCode,
      dto.name,
      user.id,
      dto.replaceExisting,
    );
  }

  @Get(':sessionCode/access-grants')
  @UseGuards(JwtAuthGuard)
  listAccessGrants(
    @Param('sessionCode') sessionCode: string,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.sessionSvc.listAccessGrants(sessionCode, user.id);
  }

  @Post(':sessionCode/access-grants/:grantId/revoke')
  @UseGuards(JwtAuthGuard)
  revokeAccessGrant(
    @Param('sessionCode') sessionCode: string,
    @Param('grantId', ParseUUIDPipe) grantId: string,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.sessionSvc.revokeAccessGrant(sessionCode, grantId, user.id);
  }

  @Get(':sessionCode/report')
  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.SERVICE_PROGRAMME_READ)
  getReport(@Param('sessionCode') sessionCode: string) {
    return this.sessionSvc.getFormattedReport(sessionCode);
  }

  @Get(':sessionCode/report/pdf')
  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.SERVICE_PROGRAMME_READ)
  async downloadReportPdf(
    @Param('sessionCode') sessionCode: string,
    @Res() res: Response,
  ) {
    await this.sendSessionReportPdf(sessionCode, res);
  }

  @Get(':sessionCode/pm/report/pdf')
  @Public()
  @UseGuards(ShareTokenGuard, NamedAccessGuard)
  async pmDownloadReportPdf(
    @Param('sessionCode') sessionCode: string,
    @Res() res: Response,
  ) {
    await this.sendSessionReportPdf(sessionCode, res);
  }

  private async sendSessionReportPdf(
    sessionCode: string,
    res: Response,
  ): Promise<void> {
    const pdf = await this.sessionSvc.getReportPdf(sessionCode);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="session-report-${sessionCode}.pdf"`,
      'Content-Length': pdf.length,
    });
    res.end(pdf);
  }

  @Get(':sessionCode/action-log')
  @UseGuards(JwtAuthGuard)
  getActionLog(
    @Param('sessionCode') sessionCode: string,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.sessionSvc.getActionLog(sessionCode, user.id);
  }

  @Get(':sessionCode/action-log/csv')
  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.SERVICE_PROGRAMME_READ)
  async downloadActionLogCsv(
    @Param('sessionCode') sessionCode: string,
    @Res() res: Response,
  ) {
    const csv = await this.sessionSvc.getActionLogCsv(sessionCode);
    res.set({
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="session-audit-log-${sessionCode}.csv"`,
    });
    res.end(csv);
  }

  @Get('event/:eventId/summary-pdf')
  @UseGuards(RolesGuard)
  @Roles(MemberRoleEnum.WORKER)
  async downloadEventSummaryPdfForWorker(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @CurrentUser() user: MemberAuth,
    @Res() res: Response,
  ) {
    const pdf = await this.sessionSvc.getEventSummaryReportPdfForWorker(
      eventId,
      user.id,
    );
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="event-summary-${eventId}.pdf"`,
      'Content-Length': pdf.length,
    });
    res.end(pdf);
  }

  @Get('event/:eventId/report/pdf')
  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.SERVICE_PROGRAMME_READ)
  async downloadEventReportPdf(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Res() res: Response,
  ) {
    const pdf = await this.sessionSvc.getFullEventReportPdf(eventId);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="event-report-${eventId}.pdf"`,
      'Content-Length': pdf.length,
    });
    res.end(pdf);
  }

  @Get('event/:eventId/report/summary-pdf')
  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.SERVICE_PROGRAMME_READ)
  async downloadEventSummaryPdf(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Res() res: Response,
  ) {
    const pdf = await this.sessionSvc.getEventSummaryReportPdf(eventId);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="event-summary-${eventId}.pdf"`,
      'Content-Length': pdf.length,
    });
    res.end(pdf);
  }
}
