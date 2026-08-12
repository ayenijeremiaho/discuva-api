import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService, ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { randomInt, randomUUID } from 'node:crypto';
import { UtilityService } from '../../utility/service/utility.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { Cron } from '@nestjs/schedule';
import { CacheService } from '../../utility/service/cache.service';
import { AdminService } from '../../admin/service/admin.service';
import { MemberService } from '../../member/service/member.service';
import { MemberSessionService } from '../../member/service/member-session.service';
import { MemberStatusEnum } from '../../member/enums/member-status.enum';
import { MemberRoleEnum } from '../../member/enums/member-role.enum';
import { WorkerStatusEnum } from '../../member/enums/worker-status.enum';
import {
  JwtPayload,
  JwtResponse,
  MemberAuth,
} from '../interface/auth.interface';
import { CHURCH_TIMEZONE } from '../../utility/constants/app.constants';
import { SessionSurface } from '../enum/session-surface.enum';
import { PasswordResetOtp } from '../entity/password-reset-otp.entity';
import { DeviceResetOtp } from '../entity/device-reset-otp.entity';
import { EmailChangeOtp } from '../entity/email-change-otp.entity';
import { DepartmentLead } from '../../department/entity/department-lead.entity';
import refreshJwtConfig from '../../config/refresh.jwt.config';
import { ChangePasswordDto } from '../../member/dto/change-password.dto';
import { SignupDto } from '../../member/dto/signup.dto';
import { ResetPasswordDto } from '../dto/reset-password.dto';
import { Member } from '../../member/entity/member.entity';
import { EmailCategory } from '../../utility/email-provider/email-category.enum';
import { PushNotificationService } from '../../push-notification/service/push-notification.service';
import { WebauthnService } from './webauthn.service';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { forEachActiveTenant } from '../../tenant/utility/for-each-active-tenant';

interface RotatedRefreshEntry {
  hash: string;
  response: JwtResponse;
  rotatedAt: number;
}

@Injectable()
export class AuthService {
  private static readonly OTP_PURGE_LOCK = 'lock:otp-purge';
  // Window in which reuse of a just-rotated refresh token is treated as a
  // benign concurrent-request race (e.g. two tabs) rather than theft.
  private static readonly REFRESH_REUSE_GRACE_MS = 10_000;
  private readonly logger = new Logger(AuthService.name);
  private readonly otpTtlSeconds: number;
  private readonly otpMaxAttempts: number;
  private readonly otpWindowSeconds: number;
  private readonly loginMaxAttempts: number;
  private readonly loginWindowSeconds: number;
  private readonly deviceResetMaxAttempts: number;
  private readonly deviceResetWindowSeconds: number;
  private readonly timezone: string;
  private readonly productName: string;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly adminService: AdminService,
    private readonly memberService: MemberService,
    private readonly sessionService: MemberSessionService,
    private readonly utilityService: UtilityService,
    private readonly auditLogService: AuditLogService,
    private readonly cacheService: CacheService,
    @Inject(refreshJwtConfig.KEY)
    private readonly jwtRefreshConfig: ConfigType<typeof refreshJwtConfig>,
    @InjectRepository(PasswordResetOtp)
    private readonly otpRepository: Repository<PasswordResetOtp>,
    @InjectRepository(DeviceResetOtp)
    private readonly deviceResetOtpRepository: Repository<DeviceResetOtp>,
    @InjectRepository(EmailChangeOtp)
    private readonly emailChangeOtpRepository: Repository<EmailChangeOtp>,
    @InjectRepository(DepartmentLead)
    private readonly departmentLeadRepo: Repository<DepartmentLead>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly pushService: PushNotificationService,
    private readonly webauthnService: WebauthnService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {
    this.otpTtlSeconds = this.configService.get<number>('OTP_TTL_SECONDS');
    this.otpMaxAttempts = this.configService.get<number>(
      'FORGOT_PASSWORD_MAX_ATTEMPTS',
    );
    this.otpWindowSeconds = this.configService.get<number>(
      'FORGOT_PASSWORD_WINDOW_SECONDS',
    );
    this.loginMaxAttempts =
      this.configService.get<number>('LOGIN_MAX_ATTEMPTS');
    this.loginWindowSeconds = this.configService.get<number>(
      'LOGIN_WINDOW_SECONDS',
    );
    this.deviceResetMaxAttempts = this.configService.get<number>(
      'DEVICE_RESET_MAX_ATTEMPTS',
    );
    this.deviceResetWindowSeconds = this.configService.get<number>(
      'DEVICE_RESET_WINDOW_SECONDS',
    );
    this.timezone = this.configService.get<string>('TIMEZONE');
    this.productName = this.configService.get<string>('PRODUCT_NAME');
  }

  async validateMember(email: string, password: string): Promise<MemberAuth> {
    await this.checkLoginRateLimit(email);

    const member = await this.memberService.findByEmail(email);
    if (!member) {
      await this.recordFailedLogin(email);
      this.logger.warn(`Failed login — email not registered: ${email}`);
      throw new UnauthorizedException('Invalid email or password');
    }

    const passwordMatches = await UtilityService.verifyHashedValue(
      password,
      member.password,
    );
    if (!passwordMatches) {
      const isNowLocked = await this.recordFailedLogin(email);
      if (isNowLocked) {
        this.logger.warn(
          `Account locked after max failed login attempts: ${email}`,
        );
        const firstName = UtilityService.capitalizeFirstLetter(
          member.firstname,
        );
        const lockoutMinutes = Math.ceil(
          this.loginWindowSeconds / 60,
        ).toString();
        this.utilityService.sendEmailWithTemplate(
          member.email,
          `${firstName}, Your ${this.productName} Account Has Been Temporarily Locked`,
          'login-security-alert',
          { name: firstName, lockoutMinutes },
        );
      }
      throw new UnauthorizedException('Invalid email or password');
    }

    this.clearLoginRateLimit(email);

    if (member.status === MemberStatusEnum.INACTIVE) {
      throw new UnauthorizedException(
        'Your account is inactive. Contact admin.',
      );
    }

    // Scoped to role === WORKER: a MEMBER-role account may still carry a
    // leftover INACTIVE WorkerProfile from a prior revoke/demotion (kept
    // around so re-promotion resumes their progress) — that's history, not a
    // reason to block an ordinary member login.
    if (member.role === MemberRoleEnum.WORKER) {
      if (!member.workerProfile) {
        throw new UnauthorizedException(
          'Worker access revoked. Please contact admin.',
        );
      }
      if (member.workerProfile.status !== WorkerStatusEnum.ACTIVE) {
        throw new UnauthorizedException(
          'Worker account suspended. Please contact admin.',
        );
      }
    }

    return {
      id: member.id,
      role: member.role,
      requiresPasswordChange: !member.changedPassword,
      surface: SessionSurface.MEMBER,
    };
  }

  async signup(dto: SignupDto): Promise<Member> {
    return this.memberService.signup(dto);
  }

  async login(user: MemberAuth, deviceId: string): Promise<JwtResponse> {
    if (!deviceId) throw new BadRequestException('deviceId is required');

    // deviceId is `select: false` on the entity — getById() would silently
    // return undefined here, making this check a no-op. getByIdWithCredentials
    // explicitly selects it (as it does for password, for the same reason).
    const member = await this.memberService.getByIdWithCredentials(user.id);

    if (member.deviceId && member.deviceId !== deviceId) {
      this.logger.warn(
        `Device mismatch for member ${user.id} — login rejected`,
      );
      throw new ForbiddenException(
        'This account is already registered on another device. Use "Reset Device Access" on the sign-in screen if this is your device now.',
      );
    }

    if (!member.deviceId) {
      this.logger.log(`First device registered for member ${user.id}`);
      await this.memberService.setDeviceId(user.id, deviceId);
    }

    const tokens = await this.generateTokens(
      user.id,
      user.role,
      user.requiresPasswordChange,
      SessionSurface.MEMBER,
    );
    this.auditLogService.log('MEMBER_LOGIN', {
      targetId: user.id,
      targetEmail: member.email,
      targetName: `${member.firstname} ${member.lastname}`,
    });

    const firstName = UtilityService.capitalizeFirstLetter(member.firstname);
    const loginTime = new Date().toLocaleString('en-GB', {
      timeZone: this.timezone,
    });
    this.utilityService.sendEmailWithTemplate(
      member.email,
      `${firstName}, New ${this.productName} Login Detected`,
      'login-notification',
      { name: firstName, loginTime },
      undefined,
      EmailCategory.LOGIN_ALERT,
    );

    return tokens;
  }

  async adminLogin(user: MemberAuth): Promise<JwtResponse> {
    const admin = await this.adminService.findByMemberId(user.id);
    if (!admin) {
      this.logger.warn(
        `Admin login rejected — no admin record for member ${user.id}`,
      );
      throw new UnauthorizedException('Invalid credentials.');
    }

    const tokens = await this.generateTokens(
      user.id,
      user.role,
      user.requiresPasswordChange,
      SessionSurface.ADMIN,
    );
    this.auditLogService.log('ADMIN_LOGIN', { actorId: user.id });

    return tokens;
  }

  // WebauthnService has already proven this device holds a previously-
  // registered credential for this memberId by the time this runs — it
  // does not independently re-check member status, same division of
  // responsibility as validateMember()/LocalStrategy for the password path.
  // Deliberately does not run the deviceId single-device-lock check
  // login() applies — WebAuthn credentials are already per-device and
  // hardware-bound, so that lock's shared/leaked-password threat model
  // doesn't apply here, and the point of allowing several registered
  // credentials per member is several trusted devices at once.
  async loginWithWebauthn(memberId: string): Promise<JwtResponse> {
    const member = await this.memberService.getById(memberId, [
      'workerProfile',
    ]);

    if (member.status === MemberStatusEnum.INACTIVE) {
      throw new UnauthorizedException(
        'Your account is inactive. Contact admin.',
      );
    }
    if (member.role === MemberRoleEnum.WORKER) {
      if (!member.workerProfile) {
        throw new UnauthorizedException(
          'Worker access revoked. Please contact admin.',
        );
      }
      if (member.workerProfile.status !== WorkerStatusEnum.ACTIVE) {
        throw new UnauthorizedException(
          'Worker account suspended. Please contact admin.',
        );
      }
    }

    const tokens = await this.generateTokens(
      member.id,
      member.role,
      !member.changedPassword,
      SessionSurface.MEMBER,
    );
    this.auditLogService.log('MEMBER_LOGIN_WEBAUTHN', {
      targetId: member.id,
      targetEmail: member.email,
      targetName: `${member.firstname} ${member.lastname}`,
    });

    return tokens;
  }

  async refreshToken(user: MemberAuth): Promise<JwtResponse> {
    if (user.replayedTokens) return user.replayedTokens;
    return this.generateTokens(
      user.id,
      user.role,
      user.requiresPasswordChange,
      user.surface,
    );
  }

  async logout(
    memberId: string,
    surface: SessionSurface,
    jti: string,
    remainingTtl: number,
  ): Promise<void> {
    await this.sessionService.updateLogout(memberId, surface);
    await this.cacheService.blacklistJti(jti, remainingTtl);
    this.auditLogService.log('MEMBER_LOGOUT', { targetId: memberId });
  }

  async validateRefreshToken(
    memberId: string,
    refreshToken: string,
    surface: SessionSurface,
  ): Promise<MemberAuth> {
    const session = await this.sessionService.getSession(memberId, surface);
    if (!session?.hashedRefreshToken)
      throw new UnauthorizedException(
        'Your session has expired. Please log in again.',
      );

    const maxAgeDays =
      this.configService.get<number>('SESSION_MAX_AGE_DAYS') ?? 30;
    if (Date.now() - session.lastLogin.getTime() > maxAgeDays * 86_400_000) {
      await this.sessionService.updateLogout(memberId, surface);
      throw new UnauthorizedException(
        'Your session has expired. Please log in again.',
      );
    }

    const isValid = await UtilityService.verifyHashedValue(
      refreshToken,
      session.hashedRefreshToken,
    );
    // Detect reuse of a previously rotated token — indicates credential theft,
    // unless it falls within the grace window (a benign concurrent-request race).
    const replayedTokens = isValid
      ? undefined
      : await this.handleRotatedTokenCheck(memberId, surface, refreshToken);

    const member = await this.memberService.getById(memberId, [
      'workerProfile',
    ]);

    if (member.status !== MemberStatusEnum.ACTIVE) {
      throw new UnauthorizedException(
        'Account is inactive. Please contact admin.',
      );
    }
    if (member.role === MemberRoleEnum.WORKER) {
      if (!member.workerProfile) {
        throw new UnauthorizedException(
          'Worker access revoked. Please log in again.',
        );
      }
      if (member.workerProfile.status !== WorkerStatusEnum.ACTIVE) {
        throw new UnauthorizedException(
          'Worker account suspended. Please log in again.',
        );
      }
    }

    return {
      id: member.id,
      role: member.role,
      requiresPasswordChange: !member.changedPassword,
      surface,
      replayedTokens,
    };
  }

  /**
   * Called when the presented refresh token doesn't match the current session
   * hash. Either resolves to the tokens already issued by a just-completed
   * rotation (benign race, within the grace window) or throws — invalidating
   * the session and alerting the member first if the token was actually reused.
   */
  private async handleRotatedTokenCheck(
    memberId: string,
    surface: SessionSurface,
    refreshToken: string,
  ): Promise<JwtResponse> {
    const rotatedKey = this.cacheService.key(
      'rt_rotated',
      `${memberId}:${surface}`,
    );
    const rotated =
      await this.cacheService.get<RotatedRefreshEntry>(rotatedKey);
    const isReused = rotated
      ? await UtilityService.verifyHashedValue(refreshToken, rotated.hash)
      : false;

    if (
      isReused &&
      rotated &&
      Date.now() - rotated.rotatedAt <= AuthService.REFRESH_REUSE_GRACE_MS
    ) {
      return rotated.response;
    }

    if (isReused) {
      this.logger.warn(
        `Refresh token reuse detected for member ${memberId} — session invalidated`,
      );
      await this.sessionService.updateLogout(memberId, surface);
      this.cacheService.del(rotatedKey);
      this.sendSessionSecurityAlert(memberId, surface);
    }
    throw new UnauthorizedException(
      'Your session is invalid. Please log in again.',
    );
  }

  async validateAccessToken(
    memberId: string,
    surface: SessionSurface,
    jti: string,
  ): Promise<MemberAuth> {
    if (await this.cacheService.isJtiBlacklisted(jti)) {
      throw new UnauthorizedException(
        'Your session has been revoked. Please log in again.',
      );
    }

    const hashed = await this.sessionService.getHashedRefreshToken(
      memberId,
      surface,
    );
    if (!hashed)
      throw new UnauthorizedException(
        'Your session has expired. Please log in again.',
      );

    const member = await this.memberService.getById(memberId, [
      'workerProfile',
    ]);

    if (member.status !== MemberStatusEnum.ACTIVE) {
      throw new UnauthorizedException(
        'Account is inactive. Please contact admin.',
      );
    }
    if (member.role === MemberRoleEnum.WORKER) {
      if (!member.workerProfile) {
        throw new UnauthorizedException(
          'Worker access revoked. Please log in again.',
        );
      }
      if (member.workerProfile.status !== WorkerStatusEnum.ACTIVE) {
        throw new UnauthorizedException(
          'Worker account suspended. Please log in again.',
        );
      }
    }

    return {
      id: member.id,
      role: member.role,
      requiresPasswordChange: !member.changedPassword,
      surface,
      workerProfileId: member.workerProfile?.id,
    };
  }

  async getProfile(
    memberId: string,
  ): Promise<{ member: Member; isHod: boolean; isTrainee: boolean }> {
    const member = await this.memberService.getById(memberId, [
      'workerProfile',
      'workerProfile.department',
      'workerProfile.secondaryDepartment',
      'clergy',
      'clergy.title',
    ]);
    let isHod = false;
    if (member.workerProfile?.id) {
      isHod = await this.departmentLeadRepo.exists({
        where: { workerProfile: { id: member.workerProfile.id } },
      });
    }
    return {
      member,
      isHod,
      isTrainee: member.workerProfile?.isTrainee ?? false,
    };
  }

  async changePassword(
    memberId: string,
    dto: ChangePasswordDto,
  ): Promise<string> {
    return this.memberService.changePassword(memberId, dto);
  }

  async forgotPassword(email: string): Promise<void> {
    await this.checkOtpRateLimit(email);

    const member = await this.memberService.findByEmail(email);
    if (!member) return; // Silent — do not leak account existence
    this.auditLogService.log('PASSWORD_RESET_REQUESTED', {
      targetId: member.id,
      targetEmail: member.email,
    });

    await this.otpRepository.delete({ memberId: member.id, usedAt: IsNull() });

    const otp = this.generateOtp();
    const otpHash = await UtilityService.hashValue(otp);
    const expiresAt = new Date(Date.now() + this.otpTtlSeconds * 1000);

    await this.otpRepository.save(
      this.otpRepository.create({
        memberId: member.id,
        otpHash,
        expiresAt,
        usedAt: null,
      }),
    );

    const firstName = UtilityService.capitalizeFirstLetter(member.firstname);
    this.utilityService.sendEmailWithTemplate(
      member.email,
      `${firstName}, Your ${this.productName} Password Reset Code`,
      'forgot-password-otp',
      {
        name: firstName,
        otp,
        expiresMinutes: Math.floor(this.otpTtlSeconds / 60).toString(),
      },
    );
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const member = await this.memberService.findByEmail(dto.email);
    if (!member) throw new BadRequestException('Invalid or expired reset code');

    const otpRecord = await this.otpRepository.findOne({
      where: { memberId: member.id, usedAt: IsNull() },
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
    if (!isValid)
      throw new BadRequestException(
        'This verification code is invalid or has expired. Please request a new one.',
      );

    otpRecord.usedAt = new Date();
    await this.otpRepository.save(otpRecord);

    await Promise.all([
      this.memberService.setPassword(member.id, dto.newPassword, true),
      this.sessionService.updateLogout(member.id, SessionSurface.MEMBER),
      this.sessionService.updateLogout(member.id, SessionSurface.ADMIN),
    ]);
    this.auditLogService.log('PASSWORD_RESET_COMPLETED', {
      targetId: member.id,
      targetEmail: member.email,
    });

    const firstName = UtilityService.capitalizeFirstLetter(member.firstname);
    this.utilityService.sendEmailWithTemplate(
      member.email,
      `${firstName}, Your ${this.productName} Password Has Been Changed`,
      'password-changed',
      { name: firstName },
    );
  }

  async requestDeviceReset(email: string, newDeviceId: string): Promise<void> {
    await this.checkDeviceResetRateLimit(email);

    const member = await this.memberService.findByEmail(email);
    if (!member) return; // Silent — do not leak account existence

    await this.deviceResetOtpRepository.delete({
      memberId: member.id,
      usedAt: IsNull(),
    });

    const otp = this.generateOtp();
    const otpHash = await UtilityService.hashValue(otp);
    const expiresAt = new Date(Date.now() + this.otpTtlSeconds * 1000);

    await this.deviceResetOtpRepository.save(
      this.deviceResetOtpRepository.create({
        memberId: member.id,
        otpHash,
        newDeviceId,
        expiresAt,
        usedAt: null,
      }),
    );

    await this.incrementDeviceResetAttempts(email);
    this.logger.log(`Device reset OTP issued for member ${member.id}`);
    this.auditLogService.log('DEVICE_RESET_REQUESTED', {
      targetId: member.id,
      targetEmail: member.email,
    });

    const firstName = UtilityService.capitalizeFirstLetter(member.firstname);
    this.utilityService.sendEmailWithTemplate(
      member.email,
      `${firstName}, Your Device Reset Code`,
      'device-reset-otp',
      {
        name: firstName,
        otp,
        expiresMinutes: Math.floor(this.otpTtlSeconds / 60).toString(),
      },
    );
  }

  async verifyDeviceReset(email: string, otp: string): Promise<void> {
    const member = await this.memberService.findByEmail(email);
    if (!member) throw new BadRequestException('Invalid or expired reset code');

    const record = await this.deviceResetOtpRepository.findOne({
      where: { memberId: member.id, usedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });

    if (!record || record.expiresAt < new Date()) {
      throw new BadRequestException(
        'This verification code is invalid or has expired. Please request a new one.',
      );
    }

    const isValid = await UtilityService.verifyHashedValue(otp, record.otpHash);
    if (!isValid) {
      throw new BadRequestException(
        'This verification code is invalid or has expired. Please request a new one.',
      );
    }

    record.usedAt = new Date();
    await this.deviceResetOtpRepository.save(record);

    await this.memberService.setDeviceId(member.id, record.newDeviceId);
    await Promise.all([
      this.sessionService.updateLogout(member.id, SessionSurface.MEMBER),
      this.sessionService.updateLogout(member.id, SessionSurface.ADMIN),
    ]);
    this.pushService.unsubscribe(member.id);
    // A WebAuthn credential never checks deviceId (see loginWithWebauthn's
    // own comment) — without this, a lost/stolen device's fingerprint or
    // Face ID would keep working right through this reset. No way to tell
    // which single credential belongs to the lost device, so all of this
    // member's are revoked; they re-enroll fresh from a device they trust.
    await this.webauthnService.revokeAllCredentials(member.id);

    this.clearDeviceResetRateLimit(email);
    this.logger.log(`Device successfully reset for member ${member.id}`);
    this.auditLogService.log('DEVICE_RESET_COMPLETED', {
      targetId: member.id,
      targetEmail: member.email,
    });

    const firstName = UtilityService.capitalizeFirstLetter(member.firstname);
    this.utilityService.sendEmailWithTemplate(
      member.email,
      `${firstName}, Your Device Has Been Changed`,
      'device-reset-confirmation',
      { name: firstName },
    );
  }

  async requestEmailChange(memberId: string, newEmail: string): Promise<void> {
    await this.checkOtpRateLimit(memberId);

    const existing = await this.memberService.findByEmail(newEmail);
    if (existing) {
      throw new ConflictException('This email address is already in use.');
    }

    const member = await this.memberService.getById(memberId);

    await this.emailChangeOtpRepository.delete({
      memberId,
      usedAt: IsNull(),
    });

    const otp = this.generateOtp();
    const otpHash = await UtilityService.hashValue(otp);
    const expiresAt = new Date(Date.now() + this.otpTtlSeconds * 1000);

    await this.emailChangeOtpRepository.save(
      this.emailChangeOtpRepository.create({
        memberId,
        otpHash,
        newEmail,
        expiresAt,
        usedAt: null,
      }),
    );

    this.auditLogService.log('EMAIL_CHANGE_REQUESTED', {
      targetId: memberId,
      targetEmail: newEmail,
    });

    const firstName = UtilityService.capitalizeFirstLetter(member.firstname);
    this.utilityService.sendEmailWithTemplate(
      newEmail,
      `${firstName}, Confirm Your New Email Address`,
      'email-change-otp',
      {
        name: firstName,
        otp,
        expiresMinutes: Math.floor(this.otpTtlSeconds / 60).toString(),
      },
    );
  }

  async confirmEmailChange(memberId: string, otp: string): Promise<void> {
    const record = await this.emailChangeOtpRepository.findOne({
      where: { memberId, usedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });

    if (!record || record.expiresAt < new Date()) {
      throw new BadRequestException(
        'This verification code is invalid or has expired. Please request a new one.',
      );
    }

    const isValid = await UtilityService.verifyHashedValue(otp, record.otpHash);
    if (!isValid) {
      throw new BadRequestException(
        'This verification code is invalid or has expired. Please request a new one.',
      );
    }

    const stillAvailable = await this.memberService.findByEmail(
      record.newEmail,
    );
    if (stillAvailable) {
      throw new ConflictException('This email address is already in use.');
    }

    record.usedAt = new Date();
    await this.emailChangeOtpRepository.save(record);

    await this.memberService.updateEmail(memberId, record.newEmail);

    this.logger.log(`Email changed for member ${memberId}`);
    this.auditLogService.log('EMAIL_CHANGE_COMPLETED', {
      targetId: memberId,
      targetEmail: record.newEmail,
    });

    const member = await this.memberService.getById(memberId);
    const firstName = UtilityService.capitalizeFirstLetter(member.firstname);
    this.utilityService.sendEmailWithTemplate(
      record.newEmail,
      `${firstName}, Your Email Address Has Been Updated`,
      'email-changed-confirmation',
      { name: firstName },
    );
  }

  @Cron('0 2 * * *', { timeZone: CHURCH_TIMEZONE })
  async purgeExpiredOtps(): Promise<void> {
    const acquired = await this.cacheService.acquireLock(
      AuthService.OTP_PURGE_LOCK,
      120,
    );
    if (!acquired) {
      this.logger.debug('OTP purge skipped — another instance holds the lock');
      return;
    }
    try {
      this.logger.log('Running scheduled purge of expired OTPs');
      const { succeeded, failed } = await forEachActiveTenant(
        this.tenantRepo,
        this.cls,
        this.txHost,
        this.logger,
        async () => {
          await this.otpRepository
            .createQueryBuilder()
            .delete()
            .where('used_at IS NOT NULL OR expires_at < :now', {
              now: new Date(),
            })
            .execute();
        },
      );
      this.logger.log(
        `OTP purge complete for ${succeeded} tenant(s), ${failed} failure(s)`,
      );
    } finally {
      this.cacheService.releaseLock(AuthService.OTP_PURGE_LOCK);
    }
  }

  private async checkDeviceResetRateLimit(email: string): Promise<void> {
    const key = this.cacheService.key('device_reset', email);
    const count = (await this.cacheService.get<number>(key)) ?? 0;
    if (count >= this.deviceResetMaxAttempts) {
      const windowHours = Math.ceil(this.deviceResetWindowSeconds / 3600);
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'TOO_MANY_REQUESTS',
          message: `Too many device reset requests. You may only request ${this.deviceResetMaxAttempts} times per ${windowHours}-hour window. Contact an admin if you need immediate access.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async incrementDeviceResetAttempts(email: string): Promise<void> {
    await this.cacheService.incr(
      this.cacheService.key('device_reset', email),
      this.deviceResetWindowSeconds,
    );
  }

  private clearDeviceResetRateLimit(email: string): void {
    this.cacheService.del(this.cacheService.key('device_reset', email));
  }

  private async checkOtpRateLimit(email: string): Promise<void> {
    const key = this.cacheService.key('otp_rate', email);
    const count = await this.cacheService.incr(key, this.otpWindowSeconds);
    if (count > this.otpMaxAttempts) {
      const windowMinutes = Math.ceil(this.otpWindowSeconds / 60);
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'TOO_MANY_REQUESTS',
          message: `Too many password reset requests. Please try again in ${windowMinutes} minutes.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async checkLoginRateLimit(email: string): Promise<void> {
    const key = this.cacheService.key('login_fail', email);
    const count = (await this.cacheService.get<number>(key)) ?? 0;

    if (count >= this.loginMaxAttempts) {
      const lockoutMinutes = Math.ceil(this.loginWindowSeconds / 60);
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'TOO_MANY_REQUESTS',
          message: `Too many failed login attempts. Your account is temporarily locked. Please try again in ${lockoutMinutes} minutes.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async recordFailedLogin(email: string): Promise<boolean> {
    const key = this.cacheService.key('login_fail', email);
    const newCount = await this.cacheService.incr(key, this.loginWindowSeconds);
    return newCount >= this.loginMaxAttempts;
  }

  private clearLoginRateLimit(email: string): void {
    this.cacheService.del(this.cacheService.key('login_fail', email));
  }

  private generateOtp(): string {
    return randomInt(0, 1000000).toString().padStart(6, '0');
  }

  private async generateTokens(
    memberId: string,
    role: MemberRoleEnum,
    requiresPasswordChange: boolean,
    surface: SessionSurface,
  ): Promise<JwtResponse> {
    const payload: JwtPayload = {
      sub: memberId,
      role,
      aud: surface,
      jti: randomUUID(),
    };

    // Every token carries the tenant it was issued for — the CLS values are
    // already correctly set by this point (TenantMiddleware resolved them,
    // however it resolved them, before this request ever reached the
    // controller) — see TenantMiddleware's own doc comment for why this is
    // what lets discuva-admin's fixed host and discuva-member's dedicated
    // api.discuva.org calls both work per-tenant without a Host-header
    // subdomain on the request that actually carries them. Applies
    // regardless of surface: discuva-member still resolves ITS OWN
    // identity from a real per-tenant Host header (unaffected, that's
    // display/branding, not this), but its outgoing API calls no longer
    // need to share that subdomain with the request destination the way
    // they used to.
    payload.tenantId = this.cls.get('tenantId');
    payload.schemaName = this.cls.get('schemaName');

    const [[access_token, refresh_token], currentHash] = await Promise.all([
      Promise.all([
        this.jwtService.signAsync(payload),
        this.jwtService.signAsync(payload, this.jwtRefreshConfig),
      ]),
      this.sessionService.getHashedRefreshToken(memberId, surface),
    ]);

    const hashedRefreshToken = await UtilityService.hashValue(refresh_token);
    await this.sessionService.updateLogin(
      memberId,
      hashedRefreshToken,
      surface,
    );

    const tokens: JwtResponse = {
      token_type: 'Bearer',
      expires_in: this.getTokenExpirySeconds(),
      access_token,
      refresh_token,
      requires_password_change: requiresPasswordChange,
    };

    // Keep the outgoing hash (and the tokens just issued) in Redis so a
    // reused rotated token can either be replayed (within the grace window)
    // or flagged as reuse (outside it) — see handleRotatedTokenCheck.
    if (currentHash) {
      const rotatedKey = this.cacheService.key(
        'rt_rotated',
        `${memberId}:${surface}`,
      );
      const entry: RotatedRefreshEntry = {
        hash: currentHash,
        response: tokens,
        rotatedAt: Date.now(),
      };
      this.cacheService.set(rotatedKey, entry, this.getRefreshExpirySeconds());
    }

    return tokens;
  }

  private sendSessionSecurityAlert(
    memberId: string,
    surface: SessionSurface,
  ): void {
    Promise.all([
      this.memberService.getById(memberId),
      this.utilityService.resolveTenantLoginUrl(
        surface === SessionSurface.ADMIN ? 'admin' : 'member',
      ),
    ])
      .then(([member, login_url]) => {
        const name = UtilityService.capitalizeFirstLetter(member.firstname);
        this.utilityService.sendEmailWithTemplate(
          member.email,
          `${name}, Security Alert — Your ${this.productName} Session Was Signed Out`,
          'session-security-alert',
          { name, login_url },
        );
      })
      .catch((err) => {
        this.logger.error(
          `Failed to send session security alert for member ${memberId}`,
          err,
        );
      });
  }

  private getRefreshExpirySeconds(): number {
    const expiry = this.jwtRefreshConfig.expiresIn as string;
    if (!expiry) return 7 * 86400;
    const match = /^(\d+)([smhd])$/i.exec(expiry);
    if (!match) return 7 * 86400;
    const value = Number.parseInt(match[1], 10);
    const units: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
    return value * (units[match[2].toLowerCase()] ?? 0);
  }

  private getTokenExpirySeconds(): number {
    const expiry = this.configService.get<string>('JWT_EXPIRY_IN');
    if (!expiry) return 0;
    const match = /^(\d+)([smhd])$/i.exec(expiry);
    if (!match) return 0;
    const value = Number.parseInt(match[1], 10);
    const units: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
    return value * (units[match[2].toLowerCase()] ?? 0);
  }
}
