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
import { ConvertService } from '../service/convert.service';
import { OutreachService } from '../service/outreach.service';
import {
  CreateConvertDto,
  CreateOutreachDto,
  LogFollowUpDto,
  UpdateOutreachTeamDto,
} from '../dto/convert.dto';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorator/current-user.decorator';
import { MemberAuth } from '../../auth/interface/auth.interface';
import { RequiresModule } from '../../church-settings/decorator/requires-module.decorator';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';
import { RolesGuard } from '../../auth/guard/roles.guard';
import { Roles } from '../../auth/decorator/roles.decorator';
import { MemberRoleEnum } from '../../member/enums/member-role.enum';
import { MemberService } from '../../member/service/member.service';

@RequiresModule('evangelism')
@Roles(MemberRoleEnum.WORKER)
@UseGuards(JwtAuthGuard, RolesGuard, ModuleEnabledGuard)
@Controller('evangelism')
export class ConvertWorkerController {
  constructor(
    private readonly convertService: ConvertService,
    private readonly outreachService: OutreachService,
    private readonly memberService: MemberService,
  ) {}

  @Post('converts')
  createConvert(
    @Body() dto: CreateConvertDto,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.convertService.createConvert(dto, user);
  }

  // Duplicate-phone path: note the contact on the existing record instead of creating another.
  @Post('converts/:id/met-again')
  metAgain(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LogFollowUpDto,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.convertService.metAgain(id, dto, user);
  }

  @Get('workers')
  searchWorkers(@CurrentUser() user: MemberAuth, @Query('q') q?: string) {
    return this.outreachService.searchWorkers(q, user.id);
  }

  @Post('outreaches')
  async createOutreach(
    @Body() dto: CreateOutreachDto,
    @CurrentUser() user: MemberAuth,
  ) {
    const creator = await this.memberService.getById(user.id);
    return this.outreachService.create(dto, creator);
  }

  @Get('outreaches/recent')
  getRecentOutreaches(@CurrentUser() user: MemberAuth) {
    return this.outreachService.getRecentForMember(user.id);
  }

  @Patch('outreaches/:id/team')
  async updateOutreachTeam(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOutreachTeamDto,
    @CurrentUser() user: MemberAuth,
  ) {
    const actor = await this.memberService.getById(user.id);
    return this.outreachService.updateTeam(
      id,
      dto.teamMemberIds,
      { memberId: actor.id, name: `${actor.firstname} ${actor.lastname}` },
      { asAdmin: false },
    );
  }
}
