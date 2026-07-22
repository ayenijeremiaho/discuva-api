import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ConvertService } from '../service/convert.service';
import { ReassignConvertDto, LinkConvertToMemberDto } from '../dto/convert.dto';
import { ConvertStatusEnum } from '../enum/convert-status.enum';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { CurrentAdmin } from '../../admin/decorator/current-admin.decorator';
import { Admin } from '../../admin/entity/admin.entity';

@UseGuards(AdminGuard)
@Controller()
export class ConvertAdminController {
  constructor(private readonly convertService: ConvertService) {}

  @RequiresPermission(AdminPermission.EVANGELISM_READ)
  @Get('evangelism/converts/admin')
  getAll(
    @Query('status') status?: ConvertStatusEnum,
    @Query('page') page = 1,
    @Query('limit') limit = 10,
  ) {
    return this.convertService.getAllConvertsForAdmin(
      Number(page),
      Number(limit),
      status,
    );
  }

  @RequiresPermission(AdminPermission.EVANGELISM_WRITE)
  @Patch('evangelism/converts/admin/:id/reassign')
  reassign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReassignConvertDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.convertService.reassignConvert(id, dto, admin.id);
  }

  @RequiresPermission(AdminPermission.EVANGELISM_WRITE)
  @Patch('evangelism/converts/admin/:id/link-member')
  linkMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LinkConvertToMemberDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.convertService.linkToMember(id, dto, admin.id);
  }

  @RequiresPermission(AdminPermission.EVANGELISM_READ)
  @Get('evangelism/converts/admin/:id/follow-up-history')
  getFollowUpHistory(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page') page = 1,
    @Query('limit') limit = 10,
  ) {
    return this.convertService.getFollowUpHistory(
      id,
      Number(page),
      Number(limit),
    );
  }
}
