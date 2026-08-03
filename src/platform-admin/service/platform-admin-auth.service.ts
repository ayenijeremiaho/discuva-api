import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { randomInt } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { PlatformAdmin } from '../entity/platform-admin.entity';
import { PlatformAdminPasswordResetOtp } from '../entity/platform-admin-password-reset-otp.entity';
import {
  PlatformAdminAuth,
  PlatformAdminJwtPayload,
} from '../interface/platform-admin-auth.interface';
import { UtilityService } from '../../utility/service/utility.service';
import { PlatformAdminResetPasswordDto } from '../dto/platform-admin-password-reset.dto';

const FORGOT_PASSWORD_OTP_TTL_SECONDS = 900; // 15 min — same as the tenant-side forgot-password window

@Injectable()
export class PlatformAdminAuthService {
  constructor(
    @InjectRepository(PlatformAdmin)
    private readonly platformAdminRepo: Repository<PlatformAdmin>,
    @InjectRepository(PlatformAdminPasswordResetOtp)
    private readonly otpRepo: Repository<PlatformAdminPasswordResetOtp>,
    private readonly jwtService: JwtService,
    private readonly utilityService: UtilityService,
    private readonly configService: ConfigService,
  ) {}

  async validateById(id: string): Promise<PlatformAdminAuth> {
    const admin = await this.platformAdminRepo.findOne({
      where: { id, isActive: true },
      relations: ['platformAdminRole'],
    });
    if (!admin) throw new UnauthorizedException();
    return {
      id: admin.id,
      email: admin.email,
      role: 'platform_admin',
      permissions: admin.platformAdminRole?.permissions ?? [],
    };
  }

  async login(
    email: string,
    password: string,
  ): Promise<{ accessToken: string; requiresPasswordChange: boolean }> {
    const admin = await this.platformAdminRepo
      .createQueryBuilder('admin')
      .addSelect('admin.passwordHash')
      .where('admin.email = :email', { email: email.toLowerCase().trim() })
      .andWhere('admin.isActive = true')
      .getOne();

    if (!admin || !(await argon2.verify(admin.passwordHash, password))) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const payload: PlatformAdminJwtPayload = {
      sub: admin.id,
      role: 'platform_admin',
    };
    return {
      accessToken: await this.jwtService.signAsync(payload),
      requiresPasswordChange: !admin.changedPassword,
    };
  }

  // Mirrors AuthService.forgotPassword — silent on an unknown email to
  // avoid leaking account existence, short 15-minute OTP window (unlike
  // the 48-hour one PlatformAdminManagementService.create() issues for a
  // brand-new admin who hasn't checked their email yet).
  async forgotPassword(email: string): Promise<void> {
    const admin = await this.platformAdminRepo.findOneBy({
      email: email.toLowerCase().trim(),
      isActive: true,
    });
    if (!admin) return;

    await this.otpRepo.delete({ platformAdminId: admin.id, usedAt: IsNull() });

    const otp = randomInt(0, 1000000).toString().padStart(6, '0');
    await this.otpRepo.save(
      this.otpRepo.create({
        platformAdminId: admin.id,
        otpHash: await UtilityService.hashValue(otp),
        expiresAt: new Date(
          Date.now() + FORGOT_PASSWORD_OTP_TTL_SECONDS * 1000,
        ),
        usedAt: null,
      }),
    );

    const productName = this.configService.get<string>('PRODUCT_NAME');
    this.utilityService.sendEmailWithTemplate(
      admin.email,
      `Your ${productName} Platform Console Password Reset Code`,
      'forgot-password-otp',
      {
        name: admin.email.split('@')[0],
        otp,
        expiresMinutes: Math.floor(
          FORGOT_PASSWORD_OTP_TTL_SECONDS / 60,
        ).toString(),
      },
    );
  }

  // Mirrors AuthService.resetPassword — verifies the OTP against the hash,
  // checks expiry, marks it used, updates the password, sets
  // changedPassword true. Used both for a self-requested reset and for a
  // brand-new admin completing the welcome flow — same endpoint either way.
  async resetPassword(dto: PlatformAdminResetPasswordDto): Promise<void> {
    const admin = await this.platformAdminRepo.findOneBy({
      email: dto.email.toLowerCase().trim(),
    });
    if (!admin) throw new BadRequestException('Invalid or expired reset code');

    const otpRecord = await this.otpRepo.findOne({
      where: { platformAdminId: admin.id, usedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });

    if (!otpRecord || otpRecord.expiresAt < new Date()) {
      throw new BadRequestException(
        'This verification code is invalid or has expired. Please request a new one.',
      );
    }

    const isValid = await UtilityService.verifyHashedValue(
      dto.otp,
      otpRecord.otpHash,
    );
    if (!isValid) {
      throw new BadRequestException(
        'This verification code is invalid or has expired. Please request a new one.',
      );
    }

    otpRecord.usedAt = new Date();
    await this.otpRepo.save(otpRecord);

    admin.passwordHash = await UtilityService.hashValue(dto.newPassword);
    admin.changedPassword = true;
    await this.platformAdminRepo.save(admin);
  }
}
