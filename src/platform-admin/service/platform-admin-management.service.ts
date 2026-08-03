import { randomInt } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { PlatformAdmin } from '../entity/platform-admin.entity';
import { PlatformAdminPasswordResetOtp } from '../entity/platform-admin-password-reset-otp.entity';
import { PlatformAdminRoleService } from './platform-admin-role.service';
import { UtilityService } from '../../utility/service/utility.service';
import {
  CreatePlatformAdminDto,
  UpdatePlatformAdminDto,
} from '../dto/platform-admin-user.dto';

// How long a platform-admin welcome OTP stays valid — same tradeoff and
// same value as TenantProvisioningService's WELCOME_OTP_TTL_HOURS: longer
// than a normal forgot-password window since a new admin may not check
// email the same day, offset by rate-limiting the verify endpoint itself.
const WELCOME_OTP_TTL_HOURS = 48;

// Onboarding/management for platform admin *users* — distinct from
// PlatformAdminAuthService (login/JWT validation) and
// PlatformAdminRoleService (the roles they're assigned). Named
// "Management" rather than reusing "PlatformAdminService" to keep it
// unambiguous from PlatformTenantService and friends.
@Injectable()
export class PlatformAdminManagementService {
  private readonly logger = new Logger(PlatformAdminManagementService.name);

  constructor(
    @InjectRepository(PlatformAdmin)
    private readonly platformAdminRepo: Repository<PlatformAdmin>,
    @InjectRepository(PlatformAdminPasswordResetOtp)
    private readonly otpRepo: Repository<PlatformAdminPasswordResetOtp>,
    private readonly roleService: PlatformAdminRoleService,
    private readonly utilityService: UtilityService,
    private readonly configService: ConfigService,
  ) {}

  async getAll(): Promise<PlatformAdmin[]> {
    return this.platformAdminRepo.find({
      relations: ['platformAdminRole'],
      order: { createdAt: 'DESC' },
    });
  }

  async getById(id: string): Promise<PlatformAdmin> {
    const admin = await this.platformAdminRepo.findOne({
      where: { id },
      relations: ['platformAdminRole'],
    });
    if (!admin) throw new NotFoundException('Platform admin not found.');
    return admin;
  }

  // No password collected from the caller — nobody onboarding a new
  // platform admin is that admin, so there's nobody present to choose one
  // (mirrors TenantProvisioningService.seedTenantAdmin's platform-admin-
  // provisioned branch). Generates a random password (never revealed to
  // anyone), a 6-digit OTP stored in platform_admin_password_reset_otps,
  // and emails a set-password link.
  async create(dto: CreatePlatformAdminDto): Promise<PlatformAdmin> {
    const email = dto.email.toLowerCase().trim();
    const exists = await this.platformAdminRepo.existsBy({ email });
    if (exists) {
      throw new ConflictException(
        `A platform admin with email "${email}" already exists.`,
      );
    }

    const role = await this.roleService.getById(dto.platformAdminRoleId);
    const passwordHash = await UtilityService.hashValue(
      UtilityService.generateRandomPassword(),
    );

    const admin = this.platformAdminRepo.create({
      email,
      passwordHash,
      isActive: true,
      changedPassword: false,
      platformAdminRole: role,
    });
    const saved = await this.platformAdminRepo.save(admin);
    this.logger.log(`Platform admin ${saved.id} (${email}) created`);

    const otp = randomInt(0, 1000000).toString().padStart(6, '0');
    await this.otpRepo.save(
      this.otpRepo.create({
        platformAdminId: saved.id,
        otpHash: await UtilityService.hashValue(otp),
        expiresAt: new Date(
          Date.now() + WELCOME_OTP_TTL_HOURS * 60 * 60 * 1000,
        ),
        usedAt: null,
      }),
    );
    this.sendWelcomeEmail(email, role.name, otp);

    return this.getById(saved.id);
  }

  async update(
    id: string,
    dto: UpdatePlatformAdminDto,
    actorId: string,
  ): Promise<PlatformAdmin> {
    if (id === actorId) {
      throw new ForbiddenException(
        'You cannot modify your own platform admin record.',
      );
    }

    const admin = await this.getById(id);
    if (dto.platformAdminRoleId) {
      admin.platformAdminRole = await this.roleService.getById(
        dto.platformAdminRoleId,
      );
    }
    if (dto.isActive !== undefined) admin.isActive = dto.isActive;

    await this.platformAdminRepo.save(admin);
    this.logger.log(`Platform admin ${id} updated by actor ${actorId}`);
    return this.getById(id);
  }

  // Fire-and-forget per this codebase's queue convention — the admin/OTP
  // rows are already durably saved by the time this is called.
  private sendWelcomeEmail(email: string, roleName: string, otp: string): void {
    const platformLoginUrl =
      this.configService.get<string>('PLATFORM_LOGIN_URL');
    const productName = this.configService.get<string>('PRODUCT_NAME');
    const setPasswordUrl = `${platformLoginUrl}/set-password?email=${encodeURIComponent(email)}&otp=${otp}`;

    this.utilityService.sendEmailWithTemplate(
      email,
      `You've been added as a ${productName} platform admin`,
      'platform-admin-welcome',
      {
        name: email.split('@')[0],
        email,
        role_name: roleName,
        otp,
        expiresHours: WELCOME_OTP_TTL_HOURS.toString(),
        set_password_url: setPasswordUrl,
      },
    );
  }
}
