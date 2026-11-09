import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Request,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../decorator/public.decorator';
import { SkipPasswordChangeCheck } from '../decorator/skip-password-change-check.decorator';
import { SessionSurface } from '../enum/session-surface.enum';
import { AccountSignInService } from '../service/account-sign-in.service';
import {
  ConfirmDeviceDto,
  ConfirmDeviceRequestDto,
  ConfirmDetailsDto,
  AccountLinkTokenDto,
  LinkConfirmDto,
  HandoffDto,
  JoinCompleteDto,
  JoinStartDto,
  JoinVerifyDto,
  SwitchChurchDto,
} from '../dto/account.dto';

// One Discuva sign-in: joining a church email-first, adding a church to an account, switching between churches.
@Controller('auth')
export class AccountController {
  constructor(private readonly accountSignIn: AccountSignInService) {}

  @Public()
  @Get('account/available')
  available(): Promise<{ available: boolean; profile: boolean }> {
    return this.accountSignIn.available();
  }

  @SkipPasswordChangeCheck()
  @Get('account')
  status(@Request() req: any) {
    this.assertMemberApp(req);
    return this.accountSignIn.status(req.user.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('account/consent')
  async consent(@Request() req: any): Promise<{ message: string }> {
    this.assertMemberApp(req);
    await this.accountSignIn.consent(req.user.id);
    return {
      message: 'Thanks. Your Discuva profile is shared with this church.',
    };
  }

  @HttpCode(HttpStatus.OK)
  @Post('account/details')
  async confirmDetails(
    @Request() req: any,
    @Body() dto: ConfirmDetailsDto,
  ): Promise<{ message: string }> {
    this.assertMemberApp(req);
    await this.accountSignIn.confirmDetails(req.user.id, dto.choices);
    return { message: 'Your details are now the same at every church.' };
  }

  @HttpCode(HttpStatus.OK)
  @Post('account/sign-out-everywhere')
  async signOutEverywhere(@Request() req: any): Promise<{ message: string }> {
    this.assertMemberApp(req);
    await this.accountSignIn.signOutEverywhere(req.user.id);
    return { message: "You've been signed out at every church." };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('join/start')
  async startJoin(@Body() dto: JoinStartDto): Promise<{ message: string }> {
    await this.accountSignIn.startJoin(dto.email, dto.deviceId);
    return { message: 'We sent a 6-digit code to that email.' };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('join/verify')
  verifyJoin(@Body() dto: JoinVerifyDto) {
    return this.accountSignIn.verifyJoin(dto.email, dto.code, dto.deviceId);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('join/complete')
  completeJoin(@Body() dto: JoinCompleteDto) {
    return this.accountSignIn.completeJoin(dto);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('account/confirm-device/request')
  async requestDeviceConfirmation(
    @Body() dto: ConfirmDeviceRequestDto,
  ): Promise<{ message: string }> {
    await this.accountSignIn.requestDeviceConfirmation(
      dto.email,
      dto.password,
      dto.deviceId,
    );
    return { message: 'We sent a 6-digit code to your email.' };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('account/confirm-device')
  confirmDevice(@Body() dto: ConfirmDeviceDto) {
    return this.accountSignIn.confirmDevice(
      dto.email,
      dto.password,
      dto.deviceId,
      dto.code,
    );
  }

  @SkipPasswordChangeCheck()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('account/link/request')
  async requestLink(@Request() req: any): Promise<{ message: string }> {
    this.assertMemberApp(req);
    await this.accountSignIn.requestLink(req.user.id);
    return { message: 'We sent a 6-digit code to your email.' };
  }

  @SkipPasswordChangeCheck()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('account/link/confirm')
  async confirmLink(
    @Request() req: any,
    @Body() dto: LinkConfirmDto,
  ): Promise<{ message: string }> {
    this.assertMemberApp(req);
    await this.accountSignIn.confirmLink(req.user.id, dto.code, dto.consent);
    return { message: 'This church is now on your Discuva account.' };
  }

  @Get('account/churches')
  churches(@Request() req: any) {
    this.assertMemberApp(req);
    return this.accountSignIn.churches(req.user.id);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('account/switch')
  switchChurch(@Request() req: any, @Body() dto: SwitchChurchDto) {
    this.assertMemberApp(req);
    return this.accountSignIn.switchChurch(req.user.id, dto.tenantId);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('account/handoff')
  redeemHandoff(@Body() dto: HandoffDto) {
    return this.accountSignIn.redeemHandoff(dto.token, dto.deviceId);
  }

  // "This wasn't me" in a security email: signs out everywhere until a password reset.
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('account/freeze')
  async freeze(@Body() dto: AccountLinkTokenDto): Promise<{ message: string }> {
    await this.accountSignIn.freeze(dto.accountId, dto.token);
    return {
      message:
        'Your Discuva account is frozen and everyone is signed out. Use "Forgot password" to set a new password.',
    };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('account/undo-email')
  async undoEmail(
    @Body() dto: AccountLinkTokenDto,
  ): Promise<{ message: string }> {
    await this.accountSignIn.undoEmail(dto.accountId, dto.token);
    return {
      message:
        'Your email is back and everyone is signed out. Use "Forgot password" to set a new password.',
    };
  }

  private assertMemberApp(req: { user?: { surface?: SessionSurface } }) {
    if (req.user?.surface !== SessionSurface.MEMBER) {
      throw new ForbiddenException('Use the member app for this.');
    }
  }
}
