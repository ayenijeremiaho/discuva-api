import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { SocialAccountService } from '../service/social-account.service';
import { SocialPostService } from '../service/social-post.service';
import { SocialOAuthConnectService } from '../service/social-oauth-connect.service';
import { SocialPostMediaService } from '../service/social-post-media.service';
import {
  CreateSocialAccountDto,
  CreateSocialPostDto,
  ScheduleSocialPostDto,
} from '../dto/social-media.dto';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { CurrentAdmin } from '../../admin/decorator/current-admin.decorator';
import { Admin } from '../../admin/entity/admin.entity';
import { RequiresModule } from '../../church-settings/decorator/requires-module.decorator';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';

// 200MB — a generous, non-configurable ceiling on the raw upload itself;
// SocialMediaValidationService is the real per-(platform, placement) size
// gate at publish time, keyed on whichever targets are actually selected.
const MAX_SOCIAL_MEDIA_UPLOAD_BYTES = 200 * 1024 * 1024;

@RequiresModule('social_media')
@UseGuards(AdminGuard, ModuleEnabledGuard)
@Controller('social-media')
export class SocialMediaController {
  constructor(
    private readonly accountService: SocialAccountService,
    private readonly postService: SocialPostService,
    private readonly oauthConnectService: SocialOAuthConnectService,
    private readonly postMediaService: SocialPostMediaService,
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
  @Get('accounts/:id/authorize-url')
  async getAuthorizeUrl(@Param('id', ParseUUIDPipe) id: string) {
    const url = await this.oauthConnectService.getAuthorizeUrl(id);
    return { url };
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
  @Post('posts/:id/media')
  @UseInterceptors(
    FilesInterceptor('files', 10, {
      limits: { fileSize: MAX_SOCIAL_MEDIA_UPLOAD_BYTES },
      fileFilter: (_req, file, cb) => {
        if (
          !file.mimetype.startsWith('image/') &&
          !file.mimetype.startsWith('video/')
        ) {
          return cb(
            new BadRequestException('Only image or video files are allowed'),
            false,
          );
        }
        cb(null, true);
      },
    }),
  )
  addMedia(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    return this.postMediaService.addMedia(id, files ?? []);
  }

  @RequiresPermission(AdminPermission.SOCIAL_MEDIA_WRITE)
  @Delete('posts/:id/media/:mediaId')
  removeMedia(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
  ) {
    return this.postMediaService.removeMedia(id, mediaId);
  }

  @RequiresPermission(AdminPermission.SOCIAL_MEDIA_WRITE)
  @Post('posts/:id/publish')
  publishPost(@Param('id', ParseUUIDPipe) id: string) {
    return this.postService.publish(id);
  }

  @RequiresPermission(AdminPermission.SOCIAL_MEDIA_WRITE)
  @Post('posts/:id/schedule')
  schedulePost(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ScheduleSocialPostDto,
  ) {
    return this.postService.schedule(id, new Date(dto.scheduledFor));
  }

  @RequiresPermission(AdminPermission.SOCIAL_MEDIA_WRITE)
  @Post('posts/:id/schedule/cancel')
  cancelSchedule(@Param('id', ParseUUIDPipe) id: string) {
    return this.postService.cancelSchedule(id);
  }

  @RequiresPermission(AdminPermission.SOCIAL_MEDIA_WRITE)
  @Delete('posts/:id')
  deletePost(@Param('id', ParseUUIDPipe) id: string) {
    return this.postService.delete(id);
  }
}
