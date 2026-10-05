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
import {
  LogFollowUpDto,
  MemberConvertListQueryDto,
  UpdateConvertStatusDto,
} from '../dto/convert.dto';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorator/current-user.decorator';
import { MemberAuth } from '../../auth/interface/auth.interface';
import { RequiresModule } from '../../church-settings/decorator/requires-module.decorator';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';

@RequiresModule('evangelism')
@UseGuards(JwtAuthGuard, ModuleEnabledGuard)
@Controller('evangelism/converts')
export class ConvertTeamController {
  constructor(private readonly convertService: ConvertService) {}

  @Get()
  list(
    @Query() query: MemberConvertListQueryDto,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.convertService.listForMember(query, user.id);
  }

  @Post(':id/follow-up')
  async logFollowUp(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LogFollowUpDto,
    @CurrentUser() user: MemberAuth,
  ) {
    await this.convertService.assertCanActOnConvert(id, user.id);
    return this.convertService.logFollowUp(id, dto, user);
  }

  @Patch(':id/status')
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateConvertStatusDto,
    @CurrentUser() user: MemberAuth,
  ) {
    await this.convertService.assertCanActOnConvert(id, user.id);
    return this.convertService.updateStatus(id, dto, user.id);
  }

  @Get(':id/follow-up-history')
  async getFollowUpHistory(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: MemberAuth,
    @Query('page') page = 1,
    @Query('limit') limit = 10,
  ) {
    await this.convertService.assertCanActOnConvert(id, user.id, {
      write: false,
    });
    return this.convertService.getFollowUpHistory(
      id,
      Number(page),
      Number(limit),
    );
  }
}
