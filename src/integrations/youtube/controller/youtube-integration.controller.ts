import { Body, Controller, Get, Patch, Put, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../../../admin/guard/admin.guard';
import { RequiresPermission } from '../../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../../admin/enum/admin-permission.enum';
import {
  SetYoutubeIntegrationActiveDto,
  UpsertYoutubeIntegrationDto,
} from '../dto/upsert-youtube-integration.dto';
import { TenantYoutubeIntegrationService } from '../service/tenant-youtube-integration.service';

// Tenant self-service for YouTube live-stream auto-announcement — any
// church admin, not platform-admin-only. Single resource per tenant, so no
// :channel or :id route param (unlike /communication-providers, which is
// one-per-channel).
@UseGuards(AdminGuard)
@Controller('youtube-integration')
export class YoutubeIntegrationController {
  constructor(private readonly service: TenantYoutubeIntegrationService) {}

  @RequiresPermission(AdminPermission.YOUTUBE_INTEGRATION_READ)
  @Get()
  get() {
    return this.service.get();
  }

  @RequiresPermission(AdminPermission.YOUTUBE_INTEGRATION_WRITE)
  @Put()
  upsert(@Body() dto: UpsertYoutubeIntegrationDto) {
    return this.service.upsert(dto);
  }

  @RequiresPermission(AdminPermission.YOUTUBE_INTEGRATION_WRITE)
  @Patch()
  setActive(@Body() dto: SetYoutubeIntegrationActiveDto) {
    return this.service.setActive(dto.isActive);
  }
}
