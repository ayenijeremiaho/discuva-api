import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThan, Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { DiscuvaAccount } from '../entity/discuva-account.entity';
import { DiscuvaAccountLink } from '../entity/discuva-account-link.entity';
import {
  DiscuvaAccountCode,
  DiscuvaAccountCodePurpose,
} from '../entity/discuva-account-code.entity';
import { CacheService } from '../../utility/service/cache.service';
import { Member } from '../../member/entity/member.entity';
import { Admin } from '../../admin/entity/admin.entity';
import { MemberSessionService } from '../../member/service/member-session.service';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { runInTenantContext } from '../../tenant/utility/run-in-tenant-context';
import { PlatformSettingsService } from '../../platform-admin/service/platform-settings.service';
import { PlatformSettingKey } from '../../platform-admin/enum/platform-setting-key.enum';
import { SessionSurface } from '../../auth/enum/session-surface.enum';
import { UtilityService } from '../../utility/service/utility.service';

export enum AccountMode {
  OFF = 0,
  TEST = 1,
  ON = 2,
}

export type MoveResult = 'MOVED' | 'LINK_AVAILABLE' | 'NONE';

const ADULT_AGE = 18;
const TEST_TENANTS_TTL_MS = 5 * 60_000;

export const normaliseEmail = (email: string) => email.trim().toLowerCase();

// Decides whether the church copy or the account holds the password and device; writes go to both so switching off never locks anyone out.
@Injectable()
export class DiscuvaAccountService {
  private readonly logger = new Logger(DiscuvaAccountService.name);
  private testTenants: { ids: Set<string>; at: number } | null = null;

  constructor(
    @InjectRepository(DiscuvaAccount)
    private readonly accountRepo: Repository<DiscuvaAccount>,
    @InjectRepository(DiscuvaAccountLink)
    private readonly linkRepo: Repository<DiscuvaAccountLink>,
    @InjectRepository(DiscuvaAccountCode)
    private readonly codeRepo: Repository<DiscuvaAccountCode>,
    private readonly cacheService: CacheService,
    private readonly utilityService: UtilityService,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(Member)
    private readonly memberRepo: Repository<Member>,
    @InjectRepository(Admin)
    private readonly adminRepo: Repository<Admin>,
    private readonly sessionService: MemberSessionService,
    private readonly platformSettings: PlatformSettingsService,
    private readonly config: ConfigService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {}

  async isOn(): Promise<boolean> {
    const mode = await this.platformSettings.getNumber(
      PlatformSettingKey.DISCUVA_ACCOUNT_MODE,
    );
    if (mode === AccountMode.ON) return true;
    if (mode !== AccountMode.TEST) return false;
    const tenantId = this.cls.get('tenantId');
    return !!tenantId && (await this.testTenantIds()).has(tenantId);
  }

  private async testTenantIds(): Promise<Set<string>> {
    if (
      this.testTenants &&
      Date.now() - this.testTenants.at < TEST_TENANTS_TTL_MS
    ) {
      return this.testTenants.ids;
    }
    const subdomains = (
      this.config.get<string>('DISCUVA_ACCOUNT_TEST_TENANTS') ?? ''
    )
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const rows = subdomains.length
      ? await this.tenantRepo.find({
          where: { subdomain: In(subdomains) },
          select: { id: true },
        })
      : [];
    const ids = new Set(rows.map((t) => t.id));
    this.testTenants = { ids, at: Date.now() };
    return ids;
  }

  // The account whose password and device apply to this member, or null when the church copy does.
  async accountFor(
    member: Pick<Member, 'discuvaAccountId'>,
  ): Promise<DiscuvaAccount | null> {
    if (!member.discuvaAccountId || !(await this.isOn())) return null;
    return this.accountRepo
      .createQueryBuilder('a')
      .addSelect('a.password')
      .addSelect('a.deviceId')
      .where('a.id = :id', { id: member.discuvaAccountId })
      .getOne();
  }

  async verifyPassword(
    member: Pick<Member, 'discuvaAccountId' | 'password'>,
    password: string,
  ): Promise<boolean> {
    const account = await this.accountFor(member);
    return UtilityService.verifyHashedValue(
      password,
      account ? account.password : member.password,
    );
  }

  async deviceOf(
    member: Pick<Member, 'discuvaAccountId' | 'deviceId'>,
  ): Promise<string | null> {
    const account = await this.accountFor(member);
    return account ? account.deviceId : (member.deviceId ?? null);
  }

  // Wrong-password and code limits for an account count across all its churches.
  async hasAccount(email: string): Promise<boolean> {
    if (!(await this.isOn())) return false;
    return this.accountRepo.exists({ where: { email: normaliseEmail(email) } });
  }

  // Runs after a password and device check has passed at this church.
  async moveOnSignIn(member: Member): Promise<MoveResult> {
    if (member.discuvaAccountId || !(await this.isOn())) return 'NONE';
    if (!this.isEligible(member)) return 'NONE';
    const tenantId = this.cls.get('tenantId');
    const email = normaliseEmail(member.email);

    const existingLink = await this.linkRepo.findOne({
      where: { tenantId, memberId: member.id },
    });
    if (existingLink) {
      await this.memberRepo.update(member.id, {
        discuvaAccountId: existingLink.accountId,
      });
      return 'MOVED';
    }

    const existing = await this.accountRepo.findOne({ where: { email } });
    if (existing) return 'LINK_AVAILABLE';

    const credentials = await this.memberRepo
      .createQueryBuilder('m')
      .addSelect('m.password')
      .addSelect('m.deviceId')
      .where('m.id = :id', { id: member.id })
      .getOneOrFail();
    let account: DiscuvaAccount;
    try {
      account = await this.accountRepo.save(
        this.accountRepo.create({
          email,
          password: credentials.password,
          deviceId: credentials.deviceId,
        }),
      );
    } catch (err) {
      // Another church moved this email first, in the same moment.
      this.logger.warn(
        `Account create raced for a member: ${(err as Error).message}`,
      );
      return 'LINK_AVAILABLE';
    }
    await this.linkRepo.save(
      this.linkRepo.create({
        accountId: account.id,
        tenantId,
        memberId: member.id,
      }),
    );
    await this.memberRepo.update(member.id, { discuvaAccountId: account.id });
    this.logger.log(`Member ${member.id} moved to a Discuva account`);
    return 'MOVED';
  }

  async setDevice(
    member: Pick<Member, 'id' | 'discuvaAccountId'>,
    deviceId: string | null,
  ): Promise<void> {
    const account = await this.accountFor(member);
    if (account) await this.accountRepo.update(account.id, { deviceId });
    await this.forEachChurchOf(member, (memberId) =>
      this.memberRepo.update(memberId, { deviceId }).then(() => undefined),
    );
  }

  async setPasswordHash(
    member: Pick<Member, 'id' | 'discuvaAccountId'>,
    hash: string,
    changedPassword: boolean,
  ): Promise<void> {
    const account = await this.accountFor(member);
    if (account) {
      await this.accountRepo.update(account.id, {
        password: hash,
        passwordChangedAt: new Date(),
        frozenAt: null,
      });
    }
    await this.forEachChurchOf(member, (memberId) =>
      this.memberRepo
        .update(memberId, { password: hash, changedPassword })
        .then(() => undefined),
    );
  }

  // Ends member-app and portal sessions at every church the person can sign in to.
  async endSessionsEverywhere(
    member: Pick<Member, 'id' | 'discuvaAccountId'>,
    options: { skipCurrent?: boolean } = {},
  ): Promise<void> {
    await this.forEachChurchOf(
      member,
      (memberId) =>
        Promise.all([
          this.sessionService.updateLogout(memberId, SessionSurface.MEMBER),
          this.sessionService.updateLogout(memberId, SessionSurface.ADMIN),
        ]).then(() => undefined),
      options,
    );
  }

  // This church's member when not moved, otherwise the person's member record at every linked church.
  async forEachChurchOf(
    member: Pick<Member, 'id' | 'discuvaAccountId'>,
    fn: (memberId: string) => Promise<void>,
    options: { skipCurrent?: boolean } = {},
  ): Promise<void> {
    const account = await this.accountFor(member);
    if (!account) {
      if (!options.skipCurrent) await fn(member.id);
      return;
    }
    await this.forEachLinkOf(account.id, fn, options);
  }

  // Sets the account's device and every linked church's copy.
  async setDeviceOnAccount(accountId: string, deviceId: string): Promise<void> {
    await this.accountRepo.update(accountId, { deviceId });
    await this.forEachLinkOf(accountId, (memberId) =>
      this.memberRepo.update(memberId, { deviceId }).then(() => undefined),
    );
  }

  private async forEachLinkOf(
    accountId: string,
    fn: (memberId: string) => Promise<void>,
    options: { skipCurrent?: boolean } = {},
  ): Promise<void> {
    const currentTenantId = this.cls.get('tenantId');
    const links = await this.linkRepo.find({ where: { accountId } });
    const others = links.filter((l) => l.tenantId !== currentTenantId);
    const tenants = others.length
      ? await this.tenantRepo.find({
          where: { id: In(others.map((l) => l.tenantId)) },
          select: { id: true, schemaName: true },
        })
      : [];
    const schemaOf = new Map(tenants.map((t) => [t.id, t.schemaName]));

    for (const link of links) {
      // The current church runs inside this request's transaction; the others in their own.
      if (link.tenantId === currentTenantId) {
        if (!options.skipCurrent) await fn(link.memberId);
        continue;
      }
      const schemaName = schemaOf.get(link.tenantId);
      if (!schemaName) continue;
      await runInTenantContext(
        this.cls,
        this.txHost,
        { tenantId: link.tenantId, schemaName },
        () => fn(link.memberId),
      );
    }
  }

  async findByEmail(email: string): Promise<DiscuvaAccount | null> {
    return this.accountRepo
      .createQueryBuilder('a')
      .addSelect('a.password')
      .addSelect('a.deviceId')
      .where('a.email = :email', { email: normaliseEmail(email) })
      .getOne();
  }

  async findById(id: string): Promise<DiscuvaAccount | null> {
    return this.accountRepo
      .createQueryBuilder('a')
      .addSelect('a.password')
      .addSelect('a.deviceId')
      .where('a.id = :id', { id })
      .getOne();
  }

  async create(
    email: string,
    passwordHash: string,
    deviceId: string | null,
  ): Promise<DiscuvaAccount> {
    return this.accountRepo.save(
      this.accountRepo.create({
        email: normaliseEmail(email),
        password: passwordHash,
        deviceId,
      }),
    );
  }

  async link(accountId: string, memberId: string): Promise<void> {
    const tenantId = this.cls.get('tenantId');
    await this.linkRepo.upsert({ accountId, tenantId, memberId }, [
      'tenantId',
      'memberId',
    ]);
    await this.memberRepo.update(memberId, { discuvaAccountId: accountId });
  }

  async linksOf(accountId: string): Promise<DiscuvaAccountLink[]> {
    return this.linkRepo.find({
      where: { accountId },
      order: { linkedAt: 'ASC' },
    });
  }

  // Issues a 6-digit code for this email, purpose and device; only this device's earlier code is replaced.
  async issueCode(
    email: string,
    purpose: DiscuvaAccountCodePurpose,
    deviceId: string,
  ): Promise<string> {
    const key = this.codeKey('account_code_req', email, purpose, deviceId);
    const limit = await this.platformSettings.getNumber(
      PlatformSettingKey.ACCOUNT_CODE_REQUESTS_PER_HOUR,
    );
    const count = await this.cacheService.incrGlobal(key, 3600);
    if (count > limit) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'TOO_MANY_REQUESTS',
          message: 'Too many codes asked for. Please try again in an hour.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const normalised = normaliseEmail(email);
    await this.codeRepo.delete({
      email: normalised,
      purpose,
      deviceId,
      usedAt: IsNull(),
    });
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const minutes = await this.codeTtlMinutes();
    await this.codeRepo.save(
      this.codeRepo.create({
        email: normalised,
        purpose,
        deviceId,
        tenantId: this.cls.get('tenantId') ?? null,
        codeHash: await UtilityService.hashValue(code),
        expiresAt: new Date(Date.now() + minutes * 60_000),
        usedAt: null,
      }),
    );
    return code;
  }

  // Wrong guesses count per email, purpose and device, so someone else can't use up the owner's tries.
  async verifyCode(
    email: string,
    purpose: DiscuvaAccountCodePurpose,
    deviceId: string,
    code: string,
  ): Promise<void> {
    const key = this.codeKey('account_code_fail', email, purpose, deviceId);
    const max = await this.platformSettings.getNumber(
      PlatformSettingKey.ACCOUNT_CODE_MAX_ATTEMPTS,
    );
    if (((await this.cacheService.getGlobal<number>(key)) ?? 0) >= max) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'TOO_MANY_REQUESTS',
          message:
            'Too many incorrect attempts. Please ask for a new code and try again.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const record = await this.codeRepo.findOne({
      where: {
        email: normaliseEmail(email),
        purpose,
        deviceId,
        usedAt: IsNull(),
      },
      order: { createdAt: 'DESC' },
    });
    const valid =
      !!record &&
      record.expiresAt > new Date() &&
      (await UtilityService.verifyHashedValue(code, record.codeHash));
    if (!valid) {
      await this.cacheService.incrGlobal(
        key,
        (await this.codeTtlMinutes()) * 60,
      );
      throw new BadRequestException(
        'This code is invalid or has expired. Please ask for a new one.',
      );
    }
    await this.codeRepo.update(record.id, { usedAt: new Date() });
    this.cacheService.delGlobal(key);
  }

  async purgeCodes(): Promise<void> {
    await this.codeRepo.delete({ expiresAt: LessThan(new Date()) });
    await this.codeRepo
      .createQueryBuilder()
      .delete()
      .where('used_at IS NOT NULL')
      .execute();
  }

  private codeTtlMinutes(): Promise<number> {
    return this.platformSettings.getNumber(
      PlatformSettingKey.ACCOUNT_CODE_TTL_MINUTES,
    );
  }

  private codeKey(
    ns: string,
    email: string,
    purpose: string,
    deviceId: string,
  ): string {
    return `${ns}:${normaliseEmail(email)}:${purpose}:${deviceId}`;
  }

  async isFrozen(member: Pick<Member, 'discuvaAccountId'>): Promise<boolean> {
    return !!(await this.accountFor(member))?.frozenAt;
  }

  // The "This wasn't me" link for a security email, when the member has an account.
  async freezeUrl(
    member: Pick<Member, 'discuvaAccountId'>,
  ): Promise<string | undefined> {
    const account = await this.accountFor(member);
    if (!account) return undefined;
    const token = await this.issueLinkToken(
      account.id,
      DiscuvaAccountCodePurpose.FREEZE,
      account.email,
    );
    return this.utilityService.resolveMemberUrl(
      `/account/freeze?a=${account.id}&t=${token}`,
    );
  }

  async emailUndoUrl(accountId: string, oldEmail: string): Promise<string> {
    const token = await this.issueLinkToken(
      accountId,
      DiscuvaAccountCodePurpose.EMAIL_UNDO,
      oldEmail,
    );
    return this.utilityService.resolveMemberUrl(
      `/account/undo-email?a=${accountId}&t=${token}`,
    );
  }

  // Long random links in security emails; only a hash is kept, and each works once.
  async issueLinkToken(
    accountId: string,
    purpose:
      DiscuvaAccountCodePurpose.FREEZE | DiscuvaAccountCodePurpose.EMAIL_UNDO,
    email: string,
  ): Promise<string> {
    const token = randomBytes(32).toString('hex');
    const days = await this.platformSettings.getNumber(
      PlatformSettingKey.ACCOUNT_LINK_VALID_DAYS,
    );
    await this.codeRepo.save(
      this.codeRepo.create({
        email: normaliseEmail(email),
        purpose,
        accountId,
        deviceId: null,
        tenantId: this.cls.get('tenantId') ?? null,
        codeHash: this.tokenHash(token),
        expiresAt: new Date(Date.now() + days * 86_400_000),
        usedAt: null,
      }),
    );
    return token;
  }

  async useLinkToken(
    accountId: string,
    purpose:
      DiscuvaAccountCodePurpose.FREEZE | DiscuvaAccountCodePurpose.EMAIL_UNDO,
    token: string,
  ): Promise<DiscuvaAccountCode> {
    const record = await this.codeRepo.findOne({
      where: {
        codeHash: this.tokenHash(token),
        purpose,
        accountId,
        usedAt: IsNull(),
      },
    });
    if (!record || record.expiresAt < new Date()) {
      throw new BadRequestException(
        'This link has expired or was already used. Contact your church if you need help.',
      );
    }
    await this.codeRepo.update(record.id, { usedAt: new Date() });
    return record;
  }

  // Blocks sign-in everywhere until the owner resets their password.
  async freeze(accountId: string): Promise<void> {
    await this.accountRepo.update(accountId, { frozenAt: new Date() });
    await this.endAllSessions(accountId);
    this.logger.warn(`Discuva account ${accountId} frozen by its owner`);
  }

  async endAllSessions(accountId: string): Promise<void> {
    await this.forEachLinkOf(accountId, (memberId) =>
      Promise.all([
        this.sessionService.updateLogout(memberId, SessionSurface.MEMBER),
        this.sessionService.updateLogout(memberId, SessionSurface.ADMIN),
      ]).then(() => undefined),
    );
  }

  // Taken by another account, or by someone else at one of this account's churches.
  async emailInUse(email: string, accountId: string): Promise<boolean> {
    const normalised = normaliseEmail(email);
    const other = await this.accountRepo.findOne({
      where: { email: normalised },
      select: { id: true },
    });
    if (other && other.id !== accountId) return true;
    let taken = false;
    await this.forEachLinkOf(accountId, async (memberId) => {
      const holder = await this.memberRepo.findOne({
        where: { email: normalised },
        select: { id: true },
      });
      if (holder && holder.id !== memberId) taken = true;
    });
    return taken;
  }

  // Moves the account and every linked church record to the new email; returns the old one.
  async changeEmail(accountId: string, newEmail: string): Promise<string> {
    const account = await this.findById(accountId);
    if (!account) throw new BadRequestException('Account not found.');
    if (await this.emailInUse(newEmail, accountId)) {
      throw new ConflictException('This email address is already in use.');
    }
    const email = normaliseEmail(newEmail);
    await this.accountRepo.update(accountId, { email });
    await this.forEachLinkOf(accountId, (memberId) =>
      this.memberRepo.update(memberId, { email }).then(() => undefined),
    );
    return account.email;
  }

  // Puts the old email back and freezes the account, so whoever changed it is signed out too.
  async undoEmailChange(accountId: string, token: string): Promise<string> {
    const record = await this.useLinkToken(
      accountId,
      DiscuvaAccountCodePurpose.EMAIL_UNDO,
      token,
    );
    await this.changeEmail(accountId, record.email);
    await this.freeze(accountId);
    return record.email;
  }

  // An admin at another of the account's churches can only be recovered there.
  async isAdminAtAnotherChurch(accountId: string): Promise<boolean> {
    let admin = false;
    await this.forEachLinkOf(
      accountId,
      async (memberId) => {
        if (
          await this.adminRepo.exists({
            where: { member: { id: memberId }, isActive: true },
          })
        ) {
          admin = true;
        }
      },
      { skipCurrent: true },
    );
    return admin;
  }

  // In-person recovery: new email, no device, an unknown password, nobody signed in anywhere.
  async recover(accountId: string, newEmail: string): Promise<string> {
    const oldEmail = await this.changeEmail(accountId, newEmail);
    const hash = await UtilityService.hashValue(
      randomBytes(32).toString('hex'),
    );
    await this.accountRepo.update(accountId, {
      deviceId: null,
      password: hash,
      frozenAt: null,
      recoveredAt: new Date(),
      passwordChangedAt: new Date(),
    });
    await this.forEachLinkOf(accountId, (memberId) =>
      this.memberRepo
        .update(memberId, {
          deviceId: null,
          password: hash,
          changedPassword: true,
        })
        .then(() => undefined),
    );
    await this.endAllSessions(accountId);
    return oldEmail;
  }

  async forEachLinkedMember(
    accountId: string,
    fn: (memberId: string) => Promise<void>,
  ): Promise<void> {
    await this.forEachLinkOf(accountId, fn);
  }

  private tokenHash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  // Basics from the person's member record at a church they already belong to.
  async basicsFrom(accountId: string): Promise<Partial<Member> | null> {
    const [first] = await this.linksOf(accountId);
    if (!first) return null;
    const tenant = await this.tenantRepo.findOne({
      where: { id: first.tenantId },
      select: { id: true, schemaName: true },
    });
    if (!tenant) return null;
    return runInTenantContext(
      this.cls,
      this.txHost,
      { tenantId: tenant.id, schemaName: tenant.schemaName },
      () =>
        this.memberRepo.findOne({
          where: { id: first.memberId },
          select: {
            id: true,
            firstname: true,
            lastname: true,
            phoneNumber: true,
            gender: true,
            birthDay: true,
            birthMonth: true,
            birthYear: true,
            maritalStatus: true,
          },
        }),
    );
  }

  // Under-18s keep church-only sign-in.
  isEligible(
    member: Pick<Member, 'email' | 'birthYear' | 'birthMonth' | 'birthDay'>,
  ): boolean {
    if (!member.email) return false;
    if (!member.birthYear) return true;
    const now = new Date();
    let age = now.getFullYear() - member.birthYear;
    // Unknown month or day counts as the latest in the year, so nobody is treated as older than they are.
    const month = member.birthMonth ?? 12;
    const day = member.birthDay ?? 31;
    if (
      now.getMonth() + 1 < month ||
      (now.getMonth() + 1 === month && now.getDate() < day)
    ) {
      age--;
    }
    return age >= ADULT_AGE;
  }
}
