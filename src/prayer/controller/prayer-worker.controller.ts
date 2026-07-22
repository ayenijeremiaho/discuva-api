import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { RolesGuard } from '../../auth/guard/roles.guard';
import { Roles } from '../../auth/decorator/roles.decorator';
import { MemberRoleEnum } from '../../member/enums/member-role.enum';
import { PrayerMeetingService } from '../service/prayer-meeting.service';
import { PrayerConfigService } from '../service/prayer-config.service';
import { PrayerAudience } from '../enum/prayer.enum';
import { SelfSelectPrayerSlotDto } from '../dto/prayer.dto';
import { RequiresModule } from '../../church-settings/decorator/requires-module.decorator';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';

@RequiresModule('prayer')
@UseGuards(JwtAuthGuard, RolesGuard, ModuleEnabledGuard)
@Roles(MemberRoleEnum.WORKER)
@Controller('prayer')
export class PrayerWorkerController {
  constructor(
    private readonly meetingService: PrayerMeetingService,
    private readonly configService: PrayerConfigService,
  ) {}

  @Get('programs')
  listPrograms(@Query('name') name?: string) {
    return this.configService.listPrograms(
      [PrayerAudience.WORKERS, PrayerAudience.ALL],
      name,
    );
  }

  @Get('available')
  getAvailableMeetings(
    @Query('programId') programId: string,
    @Query('month') month: string,
    @Query('year') year: string,
  ) {
    return this.meetingService.getAvailableMeetings(
      programId,
      Number(month),
      Number(year),
    );
  }

  @Get('my-roster')
  getMyRoster(
    @Req() req: any,
    @Query('programId') programId: string,
    @Query('month') month: string,
    @Query('year') year: string,
  ) {
    return this.meetingService.getMyRoster(
      req.user.workerProfileId,
      programId,
      Number(month),
      Number(year),
    );
  }

  @Get('my-status')
  getMyStatus(
    @Req() req: any,
    @Query('programId') programId: string,
    @Query('month') month: string,
    @Query('year') year: string,
  ) {
    return this.meetingService.getSelectionStatus(
      programId,
      req.user.workerProfileId,
      Number(month),
      Number(year),
    );
  }

  @Post('select')
  selfSelect(
    @Req() req: any,
    @Query('programId') programId: string,
    @Body() dto: SelfSelectPrayerSlotDto,
  ) {
    return this.meetingService.selfSelect(
      programId,
      req.user.workerProfileId,
      dto,
    );
  }
}
