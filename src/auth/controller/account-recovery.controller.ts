import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { CurrentUser } from '../decorator/current-user.decorator';
import { MemberAuth } from '../interface/auth.interface';
import { AccountRecoveryService } from '../service/account-recovery.service';
import {
  RecoverAccountConfirmDto,
  RecoverAccountStartDto,
} from '../dto/account.dto';

@UseGuards(AdminGuard)
@RequiresPermission(AdminPermission.MEMBERS_WRITE)
@Controller('members')
export class AccountRecoveryController {
  constructor(private readonly recovery: AccountRecoveryService) {}

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post(':id/recover-account/start')
  async start(
    @CurrentUser() user: MemberAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecoverAccountStartDto,
  ): Promise<{ message: string }> {
    await this.recovery.start(user.id, id, dto.newEmail);
    return { message: 'We sent a 6-digit code to the new email.' };
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post(':id/recover-account/confirm')
  async confirm(
    @CurrentUser() user: MemberAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecoverAccountConfirmDto,
  ): Promise<{ message: string }> {
    await this.recovery.confirm(user.id, id, dto.newEmail, dto.code);
    return {
      message:
        "Account recovered. They've been signed out everywhere and sent a code to set a new password.",
    };
  }
}
