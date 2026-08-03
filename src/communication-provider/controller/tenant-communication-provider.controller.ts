import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import {
  ChannelParamDto,
  ChannelAndProviderParamDto,
} from '../dto/channel-param.dto';
import {
  SetProviderActiveDto,
  UpsertProviderConfigDto,
} from '../dto/upsert-provider-config.dto';
import { TenantCommunicationProviderService } from '../service/tenant-communication-provider.service';

// Tenant self-service — any church admin with COMMUNICATION_PROVIDERS_*
// permission, not platform-admin-only like src/platform-admin's version.
// Deliberately not under /platform — that prefix is excluded from
// TenantMiddleware entirely (src/tenant/tenant.module.ts), and this
// endpoint needs the requesting tenant resolved to know whose config it's
// reading/writing.
@UseGuards(AdminGuard)
@Controller('communication-providers')
export class TenantCommunicationProviderController {
  constructor(private readonly service: TenantCommunicationProviderService) {}

  @RequiresPermission(AdminPermission.COMMUNICATION_PROVIDERS_READ)
  @Get()
  list(@Query('channel') channel?: 'sms' | 'email') {
    return this.service.listProviders(channel);
  }

  @RequiresPermission(AdminPermission.COMMUNICATION_PROVIDERS_WRITE)
  @Put(':channel')
  upsert(
    @Param() { channel }: ChannelParamDto,
    @Body() dto: UpsertProviderConfigDto,
  ) {
    return this.service.upsertConfig(channel, dto);
  }

  @RequiresPermission(AdminPermission.COMMUNICATION_PROVIDERS_WRITE)
  @Patch(':channel/:providerId')
  setActive(
    @Param() { channel, providerId }: ChannelAndProviderParamDto,
    @Body() dto: SetProviderActiveDto,
  ) {
    return this.service.setActive(channel, providerId, dto.isActive);
  }
}
