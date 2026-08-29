import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { SocialMediaValidationService } from '../service/social-media-validation.service';
import {
  CreateSocialAccountDto,
  CreateSocialPostDto,
  ScheduleSocialPostDto,
  UpdateTargetFocalPointDto,
  UpdateTargetOverrideDto,
} from '../dto/social-media.dto';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { CurrentAdmin } from '../../admin/decorator/current-admin.decorator';
import { Admin } from '../../admin/entity/admin.entity';
import { RequiresModule } from '../../church-settings/decorator/requires-module.decorator';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';
import { PlatformSettingsService } from '../../platform-admin/service/platform-settings.service';

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
    private readonly validationService: SocialMediaValidationService,
    private readonly platformSettingsService: PlatformSettingsService,
  ) {}

  // The frontend's "Coming Soon" gate reads this instead of a hardcoded
  // build-time flag, so a platform admin can flip the composer on for every
  // tenant (PlatformSettingKey.SOCIAL_MEDIA_ENABLED, editable from
  // discuva-platform's Platform Settings page) without a frontend deploy.
  // Independent of this tenant's own module toggle — ModuleEnabledGuard
  // above already ensures this route 403s if the tenant has switched the
  // module off for themselves.
  @RequiresPermission(AdminPermission.SOCIAL_MEDIA_READ)
  @Get('platform-enabled')
  async isPlatformEnabled() {
    return {
      enabled: await this.platformSettingsService.getSocialMediaEnabled(),
    };
  }

  // Lets the composer render live per-target character counters against
  // the same numbers enforced at publish time — see
  // SocialMediaValidationService.getConstraints()'s own comment.
  @RequiresPermission(AdminPermission.SOCIAL_MEDIA_READ)
  @Get('constraints')
  getConstraints() {
    return this.validationService.getConstraints();
  }

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
  @Patch('posts/:id/targets/:targetId/override')
  updateTargetOverride(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('targetId', ParseUUIDPipe) targetId: string,
    @Body() dto: UpdateTargetOverrideDto,
  ) {
    return this.postService.updateTargetOverride(id, targetId, dto);
  }

  @RequiresPermission(AdminPermission.SOCIAL_MEDIA_WRITE)
  @Patch('posts/:id/targets/:targetId/focal-point')
  updateTargetFocalPoint(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('targetId', ParseUUIDPipe) targetId: string,
    @Body() dto: UpdateTargetFocalPointDto,
  ) {
    return this.postService.updateTargetFocalPoint(id, targetId, dto);
  }

  @RequiresPermission(AdminPermission.SOCIAL_MEDIA_READ)
  @Get('posts/:id/targets/:targetId/stats')
  getTargetStats(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('targetId', ParseUUIDPipe) targetId: string,
  ) {
    return this.postService.getTargetStats(id, targetId);
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
