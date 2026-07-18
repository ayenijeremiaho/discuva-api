import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AnnouncementService } from '../service/announcement.service';
import {
  CreateAnnouncementDto,
  UpdateAnnouncementDto,
} from '../dto/create-announcement.dto';
import { SendSmsBroadcastDto } from '../dto/send-sms-broadcast.dto';
import { AnnouncementAudienceEnum } from '../enum/announcement-audience.enum';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorator/current-user.decorator';
import { MemberAuth } from '../../auth/interface/auth.interface';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { CurrentAdmin } from '../../admin/decorator/current-admin.decorator';
import { Admin } from '../../admin/entity/admin.entity';

@UseGuards(JwtAuthGuard)
@Controller('announcements')
export class AnnouncementController {
  constructor(private readonly announcementService: AnnouncementService) {}

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.SMS_SEND)
  @Post('sms-broadcast')
  sendSmsBroadcast(
    @Body() dto: SendSmsBroadcastDto,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.announcementService.sendSmsBroadcast(dto, user.id);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.ANNOUNCEMENTS_WRITE)
  @Post()
  create(
    @Body() dto: CreateAnnouncementDto,
    @CurrentUser() user: MemberAuth,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.announcementService.create(dto, user.id, admin);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.ANNOUNCEMENTS_WRITE)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAnnouncementDto,
    @CurrentUser() user: MemberAuth,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.announcementService.update(id, dto, user.id, admin);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.ANNOUNCEMENTS_WRITE)
  @Delete(':id')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.announcementService.delete(id, user.id);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.ANNOUNCEMENTS_READ)
  @Get('all')
  findAll(
    @Query('page') page = 1,
    @Query('limit') limit = 10,
    @Query('search') search?: string,
    @Query('audience') audience?: AnnouncementAudienceEnum,
  ) {
    return this.announcementService.getAll(
      Number(page),
      Number(limit),
      search,
      audience,
    );
  }

  @Get('feed')
  getFeed(
    @CurrentUser() user: MemberAuth,
    @Query('departmentId') departmentId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 10,
  ) {
    return this.announcementService.getForMember(
      user.id,
      user.role,
      departmentId ?? null,
      Number(page),
      Number(limit),
    );
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.announcementService.getById(id);
  }
}
