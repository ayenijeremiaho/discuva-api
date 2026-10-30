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
import { CurrentUser } from '../../auth/decorator/current-user.decorator';
import { MemberAuth } from '../../auth/interface/auth.interface';
import {
  TwoFactorConfirmDto,
  TwoFactorPasswordDto,
} from '../../utility/two-factor/two-factor.dto';
import { AdminGuard } from '../guard/admin.guard';
import { AdminTwoFactorService } from '../service/admin-two-factor.service';

// Every admin manages their own 2FA, so no permission beyond being an admin.
@UseGuards(AdminGuard)
@Throttle({ default: { limit: 10, ttl: 60_000 } })
@Controller('admin/users/me/2fa')
export class AdminTwoFactorController {
  constructor(private readonly twoFactor: AdminTwoFactorService) {}

  @Get()
  status(@CurrentUser() user: MemberAuth) {
    return this.twoFactor.getStatus(user.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('setup')
  setup(@Body() dto: TwoFactorPasswordDto, @CurrentUser() user: MemberAuth) {
    return this.twoFactor.startSetup(user.id, dto.password);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('disable')
  disable(@Body() dto: TwoFactorConfirmDto, @CurrentUser() user: MemberAuth) {
    return this.twoFactor.disable(user.id, dto.password, dto.code);
  }

  @HttpCode(HttpStatus.OK)
  @Post('backup-codes')
  backupCodes(
    @Body() dto: TwoFactorConfirmDto,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.twoFactor.regenerateBackupCodes(
      user.id,
      dto.password,
      dto.code,
    );
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('forget-devices')
  forgetDevices(
    @Body() dto: TwoFactorConfirmDto,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.twoFactor.forgetDevices(user.id, dto.password, dto.code);
  }
}
