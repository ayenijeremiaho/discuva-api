import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from '../service/auth.service';
import { Public } from '../decorator/public.decorator';
import { SkipPasswordChangeCheck } from '../decorator/skip-password-change-check.decorator';
import { LocalAuthGuard } from '../guard/local-auth.guard';
import { RefreshJwtAuthGuard } from '../guard/refresh-jwt-auth.guard';
import { JwtResponse } from '../interface/auth.interface';
import { SessionSurface } from '../enum/session-surface.enum';
import { SignupDto } from '../../member/dto/signup.dto';
import { ChangePasswordDto } from '../../member/dto/change-password.dto';
import { ForgotPasswordDto } from '../dto/forgot-password.dto';
import { ResetPasswordDto } from '../dto/reset-password.dto';
import {
  RequestDeviceResetDto,
  VerifyDeviceResetDto,
} from '../dto/device-reset.dto';
import {
  RequestEmailChangeDto,
  ConfirmEmailChangeDto,
} from '../dto/email-change.dto';
import { plainToInstance } from 'class-transformer';
import { MemberDto } from '../../member/dto/member.dto';

const REFRESH_COOKIE_NAME = 'refresh_token';
const REFRESH_COOKIE_PATH = '/v1/auth/refresh';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('signup')
  async signup(@Body() dto: SignupDto): Promise<MemberDto> {
    const member = await this.authService.signup(dto);
    return plainToInstance(MemberDto, member, {
      excludeExtraneousValues: true,
    });
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @UseGuards(LocalAuthGuard)
  @Post('login')
  async login(
    @Request() req: any,
    @Body('deviceId') deviceId: string,
  ): Promise<JwtResponse> {
    return this.authService.login(req.user, deviceId);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @UseGuards(LocalAuthGuard)
  @Post('admin-login')
  async adminLogin(
    @Request() req: any,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Omit<JwtResponse, 'refresh_token'>> {
    const { refresh_token, ...body } = await this.authService.adminLogin(
      req.user,
    );
    this.setRefreshCookie(res, refresh_token ?? '');
    return body;
  }

  @SkipPasswordChangeCheck()
  @Public()
  @HttpCode(HttpStatus.OK)
  @UseGuards(RefreshJwtAuthGuard)
  @Post('refresh')
  async refresh(
    @Request() req: any,
    @Res({ passthrough: true }) res: Response,
  ): Promise<JwtResponse> {
    const tokens = await this.authService.refreshToken(req.user);
    if (req.user.surface === SessionSurface.ADMIN) {
      const { refresh_token, ...body } = tokens;
      this.setRefreshCookie(res, refresh_token ?? '');
      return body;
    }
    return tokens;
  }

  @SkipPasswordChangeCheck()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logout')
  async logout(
    @Request() req: any,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    if (req.user.surface === SessionSurface.ADMIN) {
      this.clearRefreshCookie(res);
    }
    const remainingTtl = Math.max(
      0,
      (req.user.tokenExp ?? 0) - Math.floor(Date.now() / 1000),
    );
    await this.authService.logout(
      req.user.id,
      req.user.surface,
      req.user.jti ?? '',
      remainingTtl,
    );
  }

  @SkipPasswordChangeCheck()
  @Get('me')
  async getProfile(
    @Request() req: any,
  ): Promise<MemberDto & { isHod: boolean }> {
    const { member, isHod } = await this.authService.getProfile(req.user.id);
    const dto = plainToInstance(MemberDto, member, {
      excludeExtraneousValues: true,
    });
    return { ...dto, isHod };
  }

  @SkipPasswordChangeCheck()
  @Post('change-password')
  async changePassword(
    @Request() req: any,
    @Body() dto: ChangePasswordDto,
  ): Promise<{ message: string }> {
    const message = await this.authService.changePassword(req.user.id, dto);
    return { message };
  }

  @HttpCode(HttpStatus.OK)
  @Post('email-change/request')
  async requestEmailChange(
    @Request() req: any,
    @Body() dto: RequestEmailChangeDto,
  ): Promise<{ message: string }> {
    await this.authService.requestEmailChange(req.user.id, dto.newEmail);
    return {
      message: `A verification code has been sent to ${dto.newEmail}.`,
    };
  }

  @HttpCode(HttpStatus.OK)
  @Post('email-change/confirm')
  async confirmEmailChange(
    @Request() req: any,
    @Body() dto: ConfirmEmailChangeDto,
  ): Promise<{ message: string }> {
    await this.authService.confirmEmailChange(req.user.id, dto.otp);
    return { message: 'Your email address has been updated successfully.' };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('forgot-password')
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
  ): Promise<{ message: string }> {
    await this.authService.forgotPassword(dto.email);
    return {
      message:
        'If an account exists for this email, a reset code has been sent.',
    };
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('reset-password')
  async resetPassword(
    @Body() dto: ResetPasswordDto,
  ): Promise<{ message: string }> {
    await this.authService.resetPassword(dto);
    return { message: 'Password reset successfully. You can now log in.' };
  }

  @Public()
  @SkipPasswordChangeCheck()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('device-reset/request')
  async requestDeviceReset(
    @Body() dto: RequestDeviceResetDto,
  ): Promise<{ message: string }> {
    await this.authService.requestDeviceReset(dto.email, dto.newDeviceId);
    return {
      message:
        'If an account exists for this email, a device reset code has been sent.',
    };
  }

  @Public()
  @SkipPasswordChangeCheck()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('device-reset/verify')
  async verifyDeviceReset(
    @Body() dto: VerifyDeviceResetDto,
  ): Promise<{ message: string }> {
    await this.authService.verifyDeviceReset(dto.email, dto.otp);
    return {
      message:
        'Device updated successfully. You can now log in from your new device.',
    };
  }

  private setRefreshCookie(res: Response, token: string): void {
    const isProduction =
      this.configService.get<string>('NODE_ENV') === 'production';
    const expiry =
      this.configService.get<string>('REFRESH_JWT_EXPIRY_IN') ?? '7d';
    const match = /^(\d+)([smhd])$/i.exec(expiry);
    const units: Record<string, number> = {
      s: 1_000,
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
    };
    const maxAge = match
      ? Number.parseInt(match[1], 10) * (units[match[2].toLowerCase()] ?? 0)
      : 7 * 86_400_000;

    res.cookie(REFRESH_COOKIE_NAME, token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      path: REFRESH_COOKIE_PATH,
      maxAge,
    });
  }

  private clearRefreshCookie(res: Response): void {
    const isProduction =
      this.configService.get<string>('NODE_ENV') === 'production';
    res.clearCookie(REFRESH_COOKIE_NAME, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      path: REFRESH_COOKIE_PATH,
    });
  }
}
