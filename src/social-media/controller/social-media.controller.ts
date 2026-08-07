import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SocialAccountService } from '../service/social-account.service';
import { SocialPostService } from '../service/social-post.service';
import {
  CreateSocialAccountDto,
  CreateSocialPostDto,
} from '../dto/social-media.dto';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { CurrentAdmin } from '../../admin/decorator/current-admin.decorator';
import { Admin } from '../../admin/entity/admin.entity';
import { RequiresModule } from '../../church-settings/decorator/requires-module.decorator';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';

@RequiresModule('social_media')
@UseGuards(AdminGuard, ModuleEnabledGuard)
@Controller('social-media')
export class SocialMediaController {
  constructor(
    private readonly accountService: SocialAccountService,
    private readonly postService: SocialPostService,
  ) {}

  @RequiresPermission(AdminPermission.SOCIAL_MEDIA_WRITE)
  @Post('accounts')
  createAccount(@Body() dto: CreateSocialAccountDto) {
    return this.accountService.create(dto);
  }

  @RequiresPermission(AdminPermission.SOCIAL_MEDIA_READ)
  @Get('accounts')
  getAccounts() {
    return this.accountService.getAll();
  }

  @RequiresPermission(AdminPermission.SOCIAL_MEDIA_WRITE)
  @Delete('accounts/:id')
  deleteAccount(@Param('id', ParseUUIDPipe) id: string) {
    return this.accountService.delete(id);
  }

  @RequiresPermission(AdminPermission.SOCIAL_MEDIA_WRITE)
  @Post('posts')
  createPost(@Body() dto: CreateSocialPostDto, @CurrentAdmin() admin: Admin) {
    return this.postService.create(dto, admin.id);
  }

  @RequiresPermission(AdminPermission.SOCIAL_MEDIA_READ)
  @Get('posts')
  getPosts(@Query('page') page = 1, @Query('limit') limit = 20) {
    return this.postService.getAll(Number(page), Number(limit));
  }

  @RequiresPermission(AdminPermission.SOCIAL_MEDIA_READ)
  @Get('posts/:id')
  getPost(@Param('id', ParseUUIDPipe) id: string) {
    return this.postService.getById(id);
  }

  @RequiresPermission(AdminPermission.SOCIAL_MEDIA_WRITE)
  @Post('posts/:id/publish')
  publishPost(@Param('id', ParseUUIDPipe) id: string) {
    return this.postService.publish(id);
  }

  @RequiresPermission(AdminPermission.SOCIAL_MEDIA_WRITE)
  @Delete('posts/:id')
  deletePost(@Param('id', ParseUUIDPipe) id: string) {
    return this.postService.delete(id);
  }
}
