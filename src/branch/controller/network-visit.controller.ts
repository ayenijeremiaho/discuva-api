import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { SessionSurface } from '../../auth/enum/session-surface.enum';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { CurrentUser } from '../../auth/decorator/current-user.decorator';
import { MemberAuth } from '../../auth/interface/auth.interface';
import { NetworkVisitService } from '../service/network-visit.service';
import { VisitCheckInDto, VisitLocationDto } from '../dto/network.dto';

@Controller('network/visit')
export class NetworkVisitController {
  constructor(private readonly visits: NetworkVisitService) {}

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('nearby')
  async nearby(@Request() req: any, @Query() at: VisitLocationDto) {
    this.assertMemberApp(req);
    return { visit: await this.visits.nearby(req.user.id, at) };
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get('code/:code')
  byCode(@Request() req: any, @Param('code') code: string) {
    this.assertMemberApp(req);
    return this.visits.byCode(req.user.id, code);
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('check-in')
  checkIn(@Request() req: any, @Body() dto: VisitCheckInDto) {
    this.assertMemberApp(req);
    return this.visits.checkIn(req.user.id, dto);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.ATTENDANCE_WRITE)
  @Get('code')
  code() {
    return this.visits.codeHere();
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.ATTENDANCE_WRITE)
  @HttpCode(HttpStatus.OK)
  @Post('code/regenerate')
  regenerate(@CurrentUser() user: MemberAuth) {
    return this.visits.regenerateCode(user.id);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.ATTENDANCE_READ)
  @Get('visitors/:eventId')
  visitors(@Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.visits.visitorsAt(eventId);
  }

  private assertMemberApp(req: { user?: { surface?: SessionSurface } }) {
    if (req.user?.surface !== SessionSurface.MEMBER) {
      throw new ForbiddenException('Use the member app for this.');
    }
  }
}
