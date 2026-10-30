import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../auth/decorator/public.decorator';
import { CurrentPlatformAdmin } from '../decorator/current-platform-admin.decorator';
import {
  TwoFactorConfirmDto,
  TwoFactorPasswordDto,
} from '../../utility/two-factor/two-factor.dto';
import { PlatformAdminGuard } from '../guard/platform-admin.guard';
import { PlatformAdminAuth } from '../interface/platform-admin-auth.interface';
import { PlatformAdminTwoFactorService } from '../service/platform-admin-two-factor.service';

// Every admin manages their own 2FA, so no permission beyond a valid token.
@Public()
@UseGuards(PlatformAdminGuard)
@Throttle({ default: { limit: 10, ttl: 60_000 } })
@Controller('platform/auth/2fa')
export class PlatformAdminTwoFactorController {
  constructor(private readonly twoFactor: PlatformAdminTwoFactorService) {}

  @Get()
  status(@CurrentPlatformAdmin() admin: PlatformAdminAuth) {
    return this.twoFactor.getStatus(admin.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('setup')
  setup(
    @Body() dto: TwoFactorPasswordDto,
    @CurrentPlatformAdmin() admin: PlatformAdminAuth,
  ) {
    return this.twoFactor.startSetup(admin.id, dto.password);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('disable')
  disable(
    @Body() dto: TwoFactorConfirmDto,
    @CurrentPlatformAdmin() admin: PlatformAdminAuth,
  ) {
    return this.twoFactor.disable(admin.id, dto.password, dto.code);
  }

  @HttpCode(HttpStatus.OK)
  @Post('backup-codes')
  backupCodes(
    @Body() dto: TwoFactorConfirmDto,
    @CurrentPlatformAdmin() admin: PlatformAdminAuth,
  ) {
    return this.twoFactor.regenerateBackupCodes(
      admin.id,
      dto.password,
      dto.code,
    );
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('forget-devices')
  forgetDevices(
    @Body() dto: TwoFactorConfirmDto,
    @CurrentPlatformAdmin() admin: PlatformAdminAuth,
  ) {
    return this.twoFactor.forgetDevices(admin.id, dto.password, dto.code);
  }
}
