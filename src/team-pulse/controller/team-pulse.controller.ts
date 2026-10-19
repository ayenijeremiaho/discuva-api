import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorator/current-user.decorator';
import { MemberAuth } from '../../auth/interface/auth.interface';
import { RequiresModule } from '../../church-settings/decorator/requires-module.decorator';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';
import { TeamPulseService } from '../service/team-pulse.service';
import {
  CreateTeamPulseDto,
  RespondTeamPulseDto,
  UpdateTeamPulseDto,
} from '../dto/team-pulse.dto';

@RequiresModule('team_pulse')
@UseGuards(JwtAuthGuard, ModuleEnabledGuard)
@Controller('team-pulse')
export class TeamPulseController {
  constructor(private readonly pulses: TeamPulseService) {}

  @Get('mine')
  mine(@CurrentUser() user: MemberAuth) {
    return this.pulses.mine(user.id);
  }

  @Get('templates')
  templates() {
    return this.pulses.templates();
  }

  @Get('overview')
  overview(@CurrentUser() user: MemberAuth) {
    return this.pulses.overview(user.id);
  }

  @Get('departments/:departmentId')
  forDepartment(
    @CurrentUser() user: MemberAuth,
    @Param('departmentId', ParseUUIDPipe) departmentId: string,
  ) {
    return this.pulses.forDepartment(user.id, departmentId);
  }

  @Get('rounds/:roundId')
  round(
    @CurrentUser() user: MemberAuth,
    @Param('roundId', ParseUUIDPipe) roundId: string,
  ) {
    return this.pulses.round(user.id, roundId);
  }

  @Post('rounds/:roundId/responses')
  respond(
    @CurrentUser() user: MemberAuth,
    @Param('roundId', ParseUUIDPipe) roundId: string,
    @Body() dto: RespondTeamPulseDto,
  ) {
    return this.pulses.respond(user.id, roundId, dto);
  }

  @Post('rounds/:roundId/remind')
  remind(
    @CurrentUser() user: MemberAuth,
    @Param('roundId', ParseUUIDPipe) roundId: string,
  ) {
    return this.pulses.remind(user.id, roundId);
  }

  @Post()
  create(@CurrentUser() user: MemberAuth, @Body() dto: CreateTeamPulseDto) {
    return this.pulses.create(user.id, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: MemberAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTeamPulseDto,
  ) {
    return this.pulses.update(user.id, id, dto);
  }
}
