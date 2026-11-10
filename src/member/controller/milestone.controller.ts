import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { MilestoneService } from '../../discuva-account/service/milestone.service';
import { DiscuvaMilestone } from '../../discuva-account/entity/discuva-milestone.entity';
import {
  CreateMilestoneDto,
  MilestoneDto,
  RecordBaptismDto,
  UpdateMilestoneDto,
} from '../dto/milestone.dto';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { CurrentUser } from '../../auth/decorator/current-user.decorator';
import { MemberAuth } from '../../auth/interface/auth.interface';

const toDto = (m: DiscuvaMilestone | DiscuvaMilestone[]) =>
  plainToInstance(MilestoneDto, m, { excludeExtraneousValues: true });

// Milestones live on the person's Discuva profile; these routes only exist while Global Profile is on.
@Controller('members')
export class MilestoneController {
  constructor(private readonly milestones: MilestoneService) {}

  @UseGuards(JwtAuthGuard)
  @Get('me/milestones')
  async listMine(@CurrentUser() user: MemberAuth) {
    return toDto(await this.milestones.listMine(user.id));
  }

  @UseGuards(JwtAuthGuard)
  @Post('me/milestones')
  async create(
    @CurrentUser() user: MemberAuth,
    @Body() dto: CreateMilestoneDto,
  ) {
    return toDto(await this.milestones.create(user.id, dto));
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me/milestones/:milestoneId')
  async update(
    @CurrentUser() user: MemberAuth,
    @Param('milestoneId', ParseUUIDPipe) milestoneId: string,
    @Body() dto: UpdateMilestoneDto,
  ) {
    return toDto(await this.milestones.update(user.id, milestoneId, dto));
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('me/milestones/:milestoneId')
  async remove(
    @CurrentUser() user: MemberAuth,
    @Param('milestoneId', ParseUUIDPipe) milestoneId: string,
  ): Promise<void> {
    await this.milestones.remove(user.id, milestoneId);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.MEMBERS_READ)
  @Get(':id/milestones')
  async listForChurch(@Param('id', ParseUUIDPipe) id: string) {
    return toDto(await this.milestones.listForChurch(id));
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.MEMBERS_WRITE)
  @HttpCode(HttpStatus.OK)
  @Post(':id/milestones/baptism')
  async recordBaptism(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordBaptismDto,
  ): Promise<{ message: string }> {
    await this.milestones.recordBaptism(id, dto);
    return { message: 'Baptism recorded.' };
  }
}
