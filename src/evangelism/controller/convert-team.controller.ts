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
import { LogFollowUpDto, UpdateConvertStatusDto } from '../dto/convert.dto';
import { ConvertStatusEnum } from '../enum/convert-status.enum';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorator/current-user.decorator';
import { MemberAuth } from '../../auth/interface/auth.interface';

@UseGuards(JwtAuthGuard)
@Controller()
export class ConvertTeamController {
  constructor(private readonly convertService: ConvertService) {}

  @Get('evangelism/converts/team')
  async getTeamConverts(
    @CurrentUser() user: MemberAuth,
    @Query('status') status?: ConvertStatusEnum,
    @Query('page') page = 1,
    @Query('limit') limit = 10,
  ) {
    await this.convertService.assertIsEvangelismDeptWorker(user.id);
    return this.convertService.getTeamConverts(
      Number(page),
      Number(limit),
      status,
    );
  }

  @Post('evangelism/converts/:id/follow-up')
  async logFollowUp(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LogFollowUpDto,
    @CurrentUser() user: MemberAuth,
  ) {
    await this.convertService.assertIsEvangelismDeptWorker(user.id);
    return this.convertService.logFollowUp(id, dto, user);
  }

  @Patch('evangelism/converts/:id/status')
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateConvertStatusDto,
    @CurrentUser() user: MemberAuth,
  ) {
    await this.convertService.assertIsEvangelismDeptWorker(user.id);
    return this.convertService.updateStatus(id, dto, user.id);
  }

  @Get('evangelism/converts/:id/follow-up-history')
  async getFollowUpHistory(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: MemberAuth,
    @Query('page') page = 1,
    @Query('limit') limit = 10,
  ) {
    await this.convertService.assertIsEvangelismDeptWorker(user.id);
    return this.convertService.getFollowUpHistory(
      id,
      Number(page),
      Number(limit),
    );
  }
}
