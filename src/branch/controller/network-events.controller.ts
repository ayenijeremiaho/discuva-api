import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { MemberRoleEnum } from '../../member/enums/member-role.enum';
import { NetworkEventsService } from '../service/network-events.service';
import { DateWindowDto, HiddenDto } from '../dto/network.dto';

@Controller('network')
export class NetworkEventsController {
  constructor(private readonly events: NetworkEventsService) {}

  // Member app: events the churches above this one shared with it.
  @UseGuards(JwtAuthGuard)
  @Get('events')
  forMember(@Request() req: any, @Query() q: DateWindowDto) {
    return this.events.forMember(
      req.user.role === MemberRoleEnum.WORKER,
      new Date(q.from),
      new Date(q.to),
    );
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.EVENTS_READ)
  @Get('events/shared')
  sharedHere() {
    return this.events.sharedHere();
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.EVENTS_WRITE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Put('events/:tenantId/:eventId/hidden')
  setHidden(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: HiddenDto,
  ) {
    return this.events.setHidden(tenantId, eventId, dto.hidden);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.BRANCH_READ)
  @Get('agenda')
  agenda(@Query() q: DateWindowDto) {
    return this.events.agenda(new Date(q.from), new Date(q.to), q.churchId);
  }
}
