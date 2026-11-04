import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { CurrentUser } from '../../auth/decorator/current-user.decorator';
import { MemberAuth } from '../../auth/interface/auth.interface';
import { CommunityService } from '../service/community.service';
import {
  CategoryDto,
  CategoryOrderDto,
  ModeratorDto,
  ResolveReportDto,
} from '../dto/team-space.dto';

// Works before Community is switched on, so admins can set it up first.
@UseGuards(AdminGuard)
@RequiresPermission(AdminPermission.COMMUNITY_MODERATE)
@Controller('admin/community')
export class AdminCommunityController {
  constructor(private readonly community: CommunityService) {}

  @Get('moderators')
  moderators() {
    return this.community.moderators();
  }

  @Post('moderators')
  addModerator(@CurrentUser() user: MemberAuth, @Body() dto: ModeratorDto) {
    return this.community.addModerator(user.id, dto.memberId);
  }

  @Delete('moderators/:memberId')
  removeModerator(
    @CurrentUser() user: MemberAuth,
    @Param('memberId', ParseUUIDPipe) memberId: string,
  ) {
    return this.community.removeModerator(user.id, memberId);
  }

  @Get('categories')
  categories() {
    return this.community.categories();
  }

  @Post('categories')
  addCategory(@CurrentUser() user: MemberAuth, @Body() dto: CategoryDto) {
    return this.community.addCategory(user.id, dto.name);
  }

  @Put('categories/order')
  reorder(@CurrentUser() user: MemberAuth, @Body() dto: CategoryOrderDto) {
    return this.community.reorderCategories(user.id, dto.ids);
  }

  @Patch('categories/:id')
  renameCategory(
    @CurrentUser() user: MemberAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CategoryDto,
  ) {
    return this.community.renameCategory(user.id, id, dto.name);
  }

  @Delete('categories/:id')
  removeCategory(
    @CurrentUser() user: MemberAuth,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.community.removeCategory(user.id, id);
  }

  @Get('reports')
  reports(
    @CurrentUser() user: MemberAuth,
    @Query('page', new ParseIntPipe({ optional: true })) page?: number,
  ) {
    return this.community.reports(user.id, page);
  }

  @Post('reports/:id/resolve')
  resolve(
    @CurrentUser() user: MemberAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveReportDto,
  ) {
    return this.community.resolve(user.id, id, dto.outcome);
  }
}
