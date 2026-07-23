import {
  Body,
  Controller,
  Delete,
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
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { RequiresModule } from '../../church-settings/decorator/requires-module.decorator';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';
import { SmallGroupService } from '../service/small-group.service';
import { RecordAttendanceDto } from '../dto/record-attendance.dto';

@RequiresModule('small_groups')
@UseGuards(JwtAuthGuard, ModuleEnabledGuard)
@Controller('small-groups')
export class SmallGroupController {
  constructor(private readonly smallGroupService: SmallGroupService) {}

  @Get()
  list(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.smallGroupService.listGroupsWithMemberCount(
      page ? +page : 1,
      limit ? +limit : 20,
    );
  }

  @Get('mine')
  listMine(@Request() req: any) {
    return this.smallGroupService.listMine(req.user.id);
  }

  @Get(':id')
  getOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.smallGroupService.getOne(id);
  }

  @Get(':id/members')
  getMembers(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.smallGroupService.getMembers(id, req.user.id);
  }

  @Post(':id/join')
  @HttpCode(HttpStatus.OK)
  join(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.smallGroupService.join(id, req.user.id);
  }

  @Delete(':id/leave')
  @HttpCode(HttpStatus.NO_CONTENT)
  leave(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.smallGroupService.leave(id, req.user.id);
  }

  @Post(':id/attendance')
  recordAttendance(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordAttendanceDto,
    @Request() req: any,
  ) {
    return this.smallGroupService.recordAttendance(id, req.user.id, dto);
  }
}
