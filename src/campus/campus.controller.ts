import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Public } from '../auth/decorator/public.decorator';
import { JwtAuthGuard } from '../auth/guard/jwt-auth.guard';
import { CurrentUser } from '../auth/decorator/current-user.decorator';
import { MemberAuth } from '../auth/interface/auth.interface';
import { AdminGuard } from '../admin/guard/admin.guard';
import { CurrentAdmin } from '../admin/decorator/current-admin.decorator';
import { RequiresPermission } from '../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../admin/enum/admin-permission.enum';
import { Admin } from '../admin/entity/admin.entity';
import { CampusService } from './campus.service';
import {
  CampusMovesQueryDto,
  CreateCampusDto,
  MoveMyCampusDto,
  SetCampusVenuesDto,
  UpdateCampusDto,
} from './campus.dto';

@Controller('campuses')
export class CampusController {
  constructor(private readonly campuses: CampusService) {}

  @Public()
  @Get('public')
  publicChoices() {
    return this.campuses.publicChoices();
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  mine(@CurrentUser() user: MemberAuth) {
    return this.campuses.forMember(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Patch('me')
  move(@CurrentUser() user: MemberAuth, @Body() dto: MoveMyCampusDto) {
    return this.campuses.moveMyself(user.id, dto.campusId);
  }
}

@UseGuards(AdminGuard)
@Controller('admin/campuses')
export class CampusAdminController {
  constructor(private readonly campuses: CampusService) {}

  @RequiresPermission(AdminPermission.MEMBERS_READ)
  @Get()
  list() {
    return this.campuses.listForAdmin();
  }

  @RequiresPermission(AdminPermission.ADMIN_WRITE)
  @Post()
  create(@Body() dto: CreateCampusDto, @CurrentAdmin() admin: Admin) {
    return this.campuses.create(dto, admin.member?.id);
  }

  @RequiresPermission(AdminPermission.MEMBERS_READ)
  @Get('moves')
  moves(@Query() query: CampusMovesQueryDto) {
    return this.campuses.moves(query);
  }

  @RequiresPermission(AdminPermission.MEMBERS_READ)
  @Get('move-requests')
  moveRequests() {
    return this.campuses.moveRequests();
  }

  @RequiresPermission(AdminPermission.MEMBERS_WRITE)
  @HttpCode(HttpStatus.OK)
  @Post('move-requests/:id/approve')
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.campuses.decideRequest(id, true, admin.member.id);
  }

  @RequiresPermission(AdminPermission.MEMBERS_WRITE)
  @HttpCode(HttpStatus.OK)
  @Post('move-requests/:id/decline')
  decline(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.campuses.decideRequest(id, false, admin.member.id);
  }

  @RequiresPermission(AdminPermission.ADMIN_WRITE)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCampusDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.campuses.update(id, dto, admin.member?.id);
  }

  @RequiresPermission(AdminPermission.VENUES_WRITE)
  @Put(':id/venues')
  setVenues(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetCampusVenuesDto,
  ) {
    return this.campuses.setVenues(id, dto.venueIds);
  }
}
