import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorator/current-user.decorator';
import { MemberAuth } from '../../auth/interface/auth.interface';
import { RequiresModule } from '../../church-settings/decorator/requires-module.decorator';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';
import { CommunityService } from '../service/community.service';
import { MuteDto, ReportDto, ResolveReportDto } from '../dto/team-space.dto';

// Members report; moderators handle reports and mutes from the app.
@RequiresModule('community')
@UseGuards(JwtAuthGuard, ModuleEnabledGuard)
@Controller('community')
export class CommunityController {
  constructor(private readonly community: CommunityService) {}

  @Post('posts/:postId/report')
  reportPost(
    @CurrentUser() user: MemberAuth,
    @Param('postId', ParseUUIDPipe) postId: string,
    @Body() dto: ReportDto,
  ) {
    return this.community.report(user.id, { postId }, dto.reason);
  }

  @Post('replies/:replyId/report')
  reportReply(
    @CurrentUser() user: MemberAuth,
    @Param('replyId', ParseUUIDPipe) replyId: string,
    @Body() dto: ReportDto,
  ) {
    return this.community.report(user.id, { replyId }, dto.reason);
  }

  @Get('reports')
  reports(
    @CurrentUser() user: MemberAuth,
    @Query('page', new ParseIntPipe({ optional: true })) page?: number,
  ) {
    return this.community.reports(user.id, page);
  }

  @Post('reports/:id/resolve')
  resolve(
    @CurrentUser() user: MemberAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveReportDto,
  ) {
    return this.community.resolve(user.id, id, dto.outcome);
  }

  @Post('mutes')
  mute(@CurrentUser() user: MemberAuth, @Body() dto: MuteDto) {
    return this.community.mute(user.id, dto.memberId, dto.days, dto.reason);
  }

  @Delete('mutes/:memberId')
  unmute(
    @CurrentUser() user: MemberAuth,
    @Param('memberId', ParseUUIDPipe) memberId: string,
  ) {
    return this.community.unmute(user.id, memberId);
  }
}
