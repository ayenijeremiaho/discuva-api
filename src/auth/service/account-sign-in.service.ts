import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { randomBytes } from 'node:crypto';
import {
  DiscuvaAccountService,
  normaliseEmail,
} from '../../discuva-account/service/discuva-account.service';
import { DiscuvaAccount } from '../../discuva-account/entity/discuva-account.entity';
import { DiscuvaAccountCodeService } from '../../discuva-account/service/discuva-account-code.service';
import { DiscuvaAccountCodePurpose } from '../../discuva-account/entity/discuva-account-code.entity';
import { MemberService } from '../../member/service/member.service';
import { MemberStatusEnum } from '../../member/enums/member-status.enum';
import { Member } from '../../member/entity/member.entity';
import { SignupDto } from '../../member/dto/signup.dto';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { CacheService } from '../../utility/service/cache.service';
import { UtilityService } from '../../utility/service/utility.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { JoinCompleteDto } from '../dto/account.dto';
import {
  DetailChoice,
  DetailToConfirm,
  DiscuvaProfileService,
} from '../../discuva-account/service/discuva-profile.service';
import { JwtResponse } from '../interface/auth.interface';
import { AuthService, DEVICE_CONFIRMATION_REQUIRED } from './auth.service';
import { SessionSurface } from '../enum/session-surface.enum';

const JOIN_TOKEN_TTL_SECONDS = 15 * 60;
const HANDOFF_TTL_SECONDS = 60;
const OTHER_PHONE =
  'This church app is registered on another phone. Use "Reset Device Access" on the sign-in screen if this is your phone now.';

interface JoinTicket {
  email: string;
  deviceId: string;
  tenantId: string;
  accountId: string | null;
}

interface HandoffTicket {
  accountId: string;
  tenantId: string;
  memberId: string;
}

export type JoinVerifyResult =
  | { status: 'ALREADY_MEMBER' }
  | {
      status: 'EXISTING_ACCOUNT';
      joinToken: string;
      firstName: string | null;
      needsName: boolean;
    }
  | { status: 'NEW'; joinToken: string };

type JoinDetails = Omit<JoinCompleteDto, 'joinToken' | 'deviceId' | 'password'>;

interface JoinPlan {
  account: DiscuvaAccount;
  signup: SignupDto;
  createdNow: boolean;
}

// Joining a church email-first, adding a church to an account, and moving between an account's churches.
@Injectable()
export class AccountSignInService {
  constructor(
    private readonly accounts: DiscuvaAccountService,
    private readonly codes: DiscuvaAccountCodeService,
    private readonly memberService: MemberService,
    private readonly authService: AuthService,
    private readonly cacheService: CacheService,
    private readonly utilityService: UtilityService,
    private readonly auditLogService: AuditLogService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly profiles: DiscuvaProfileService,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
  ) {}

  // Sent either way, so the reply never says whether someone has an account or belongs here.
  async startJoin(email: string, deviceId: string): Promise<void> {
    await this.assertOn();
    const account = await this.accounts.findByEmail(email);
    const basics = account ? await this.basicsOf(account.id) : null;
    const churchName = await this.utilityService.resolveChurchName();
    await this.codes.sendCode(email, DiscuvaAccountCodePurpose.JOIN, deviceId, {
      firstName: basics?.firstname ?? null,
      action: `You asked to join ${churchName} on Discuva.`,
    });
  }

  async verifyJoin(
    email: string,
    code: string,
    deviceId: string,
  ): Promise<JoinVerifyResult> {
    await this.assertOn();
    await this.codes.verifyCode(
      email,
      DiscuvaAccountCodePurpose.JOIN,
      deviceId,
      code,
    );
    const here = await this.memberService.findByEmail(email);
    if (here && here.status !== MemberStatusEnum.PENDING) {
      return { status: 'ALREADY_MEMBER' };
    }
    const account = await this.accounts.findByEmail(email);
    const joinToken = randomBytes(32).toString('hex');
    const ticket: JoinTicket = {
      email: normaliseEmail(email),
      deviceId,
      tenantId: this.cls.get('tenantId'),
      accountId: account?.id ?? null,
    };
    await this.cacheService.setGlobal(
      this.joinKey(joinToken),
      ticket,
      JOIN_TOKEN_TTL_SECONDS,
    );
    if (!account) return { status: 'NEW', joinToken };
    const basics = await this.basicsOf(account.id);
    return {
      status: 'EXISTING_ACCOUNT',
      joinToken,
      firstName: basics?.firstname ?? null,
      needsName: !basics?.firstname,
    };
  }

  async completeJoin(dto: JoinCompleteDto): Promise<JwtResponse> {
    await this.assertOn();
    const ticket = await this.cacheService.getGlobal<JoinTicket>(
      this.joinKey(dto.joinToken),
    );
    if (
      !ticket ||
      ticket.tenantId !== this.cls.get('tenantId') ||
      ticket.deviceId !== dto.deviceId
    ) {
      throw new BadRequestException(
        'This step has expired. Please start again with your email.',
      );
    }
    const { joinToken, deviceId, password, consent, ...details } = dto;
    await this.assertConsent(consent);

    const { account, signup, createdNow } = ticket.accountId
      ? await this.joinWithAccount(ticket, deviceId, details)
      : await this.joinAsNew(ticket, deviceId, password, details);

    let member: Member;
    try {
      member = await this.memberService.createForAccount(
        signup,
        account,
        deviceId,
      );
      await this.accounts.link(account.id, member.id, !!consent);
    } catch (err) {
      // A new account that never got its church would block this email later.
      if (createdNow) await this.accounts.remove(account.id);
      throw err;
    }
    this.cacheService.delGlobal(this.joinKey(joinToken));
    const full = await this.memberService.getById(member.id, ['workerProfile']);
    if (await this.profiles.ownerOf(full)) await this.profiles.reconcile(full);
    return this.authService.startMemberSession(full, 'MEMBER_LOGIN');
  }

  // Basics come from a church the person already belongs to; only an account with none left needs a name here.
  private async joinWithAccount(
    ticket: JoinTicket,
    deviceId: string,
    details: JoinDetails,
  ): Promise<JoinPlan> {
    const account = await this.accounts.findById(ticket.accountId!);
    if (!account) throw new BadRequestException('Please start again.');
    this.assertNotFrozen(account);
    const basics = await this.basicsOf(account.id);
    const firstname = basics?.firstname ?? details.firstname?.trim();
    const lastname = basics?.lastname ?? details.lastname?.trim();
    if (!firstname || !lastname) {
      throw new BadRequestException('Please give your first and last name.');
    }
    const signup = {
      ...details,
      ...this.definedBasics(basics),
      firstname,
      lastname,
      email: ticket.email,
    } as SignupDto;
    return { account, signup, createdNow: false };
  }

  private async joinAsNew(
    ticket: JoinTicket,
    deviceId: string,
    password: string | undefined,
    details: JoinDetails,
  ): Promise<JoinPlan> {
    if (!details.firstname?.trim() || !details.lastname?.trim() || !password) {
      throw new BadRequestException(
        'Your first name, last name and a password are needed.',
      );
    }
    const signup = { ...details, email: ticket.email } as SignupDto;
    const adult = this.accounts.isEligible({
      email: signup.email,
      birthYear: signup.birthYear ?? null,
      birthMonth: signup.birthMonth ?? null,
      birthDay: signup.birthDay ?? null,
    });
    if (!adult) {
      throw new ForbiddenException(
        'People under 18 join through their church. Please ask a leader to add you.',
      );
    }
    const created = await this.accounts.create(
      ticket.email,
      await UtilityService.hashValue(password),
      deviceId,
    );
    const account = await this.accounts.findById(created.id);
    return { account: account!, signup, createdNow: true };
  }

  async requestLink(memberId: string): Promise<void> {
    await this.assertOn();
    const { member, account } = await this.linkCandidate(memberId);
    const churchName = await this.utilityService.resolveChurchName();
    await this.codes.sendCode(
      account.email,
      DiscuvaAccountCodePurpose.LINK,
      this.linkDevice(member),
      {
        firstName: member.firstname,
        action: `You asked to add ${churchName} to your Discuva account. Once you do, your Discuva password works here and your old ${churchName} password stops working.`,
      },
    );
  }

  async confirmLink(
    memberId: string,
    code: string,
    consent = false,
  ): Promise<void> {
    await this.assertOn();
    await this.assertConsent(consent);
    const { member, account } = await this.linkCandidate(memberId);
    await this.codes.verifyCode(
      member.email,
      DiscuvaAccountCodePurpose.LINK,
      this.linkDevice(member),
      code,
    );
    await this.accounts.link(account.id, member.id, consent);
    await this.memberService.applyAccountCredentials(member.id, account);
    if (await this.accounts.isProfileOn()) {
      await this.profiles.reconcile(
        Object.assign(member, { discuvaAccountId: account.id }),
      );
    }
    this.auditLogService.log('ACCOUNT_LINKED', {
      targetId: member.id,
      targetEmail: member.email,
    });
  }

  async churches(memberId: string) {
    const account = await this.movedAccount(memberId);
    const links = await this.accounts.linksOf(account.id);
    const tenants = await this.tenantRepo.find({
      where: { id: In(links.map((l) => l.tenantId)), isActive: true },
      select: { id: true, name: true, subdomain: true, logoUrl: true },
    });
    const current = this.cls.get('tenantId');
    return tenants.map((t) => ({
      tenantId: t.id,
      name: t.name,
      subdomain: t.subdomain,
      logoUrl: t.logoUrl,
      current: t.id === current,
    }));
  }

  async switchChurch(
    memberId: string,
    tenantId: string,
  ): Promise<{ subdomain: string; token: string }> {
    const account = await this.movedAccount(memberId);
    const link = (await this.accounts.linksOf(account.id)).find(
      (l) => l.tenantId === tenantId,
    );
    const tenant = link
      ? await this.tenantRepo.findOne({
          where: { id: tenantId, isActive: true },
          select: { id: true, subdomain: true },
        })
      : null;
    if (!link || !tenant) {
      throw new NotFoundException("You're not a member of that church.");
    }
    const token = randomBytes(32).toString('hex');
    const ticket: HandoffTicket = {
      accountId: account.id,
      tenantId,
      memberId: link.memberId,
    };
    await this.cacheService.setGlobal(
      this.handoffKey(token),
      ticket,
      HANDOFF_TTL_SECONDS,
    );
    this.auditLogService.log('ACCOUNT_CHURCH_SWITCHED', {
      actorId: memberId,
      targetId: link.memberId,
    });
    return { subdomain: tenant.subdomain, token };
  }

  // Runs at the church being switched to.
  async redeemHandoff(token: string, deviceId: string): Promise<JwtResponse> {
    await this.assertOn();
    const key = this.handoffKey(token);
    const ticket = await this.cacheService.getGlobal<HandoffTicket>(key);
    this.cacheService.delGlobal(key);
    if (!ticket || ticket.tenantId !== this.cls.get('tenantId')) {
      throw new BadRequestException('Please try switching again.');
    }
    const account = await this.accounts.findById(ticket.accountId);
    if (!account) throw new BadRequestException('Please try switching again.');
    this.assertNotFrozen(account);
    const member = await this.memberService.getByIdWithCredentials(
      ticket.memberId,
    );
    if (member.discuvaAccountId !== account.id) {
      throw new BadRequestException('Please try switching again.');
    }
    // This church app keeps its own phone: a different one is refused, and a new one confirms by signing in once.
    if (member.deviceId && member.deviceId !== deviceId) {
      throw new ForbiddenException(OTHER_PHONE);
    }
    if (!member.deviceId) {
      if (await this.accounts.needsDeviceConfirmation(member, deviceId)) {
        throw new ForbiddenException({
          message:
            'Sign in here once with your Discuva email and password to confirm this phone.',
          code: DEVICE_CONFIRMATION_REQUIRED,
        });
      }
      await this.accounts.registerDevice(member, deviceId);
    }
    const full = await this.memberService.getById(member.id, ['workerProfile']);
    return this.authService.startMemberSession(full, 'MEMBER_LOGIN');
  }

  // Password first, so only the owner can make the code arrive; the code then proves the inbox.
  async requestDeviceConfirmation(
    email: string,
    password: string,
    deviceId: string,
  ): Promise<void> {
    await this.assertOn();
    const member = await this.signedInMember(email, password, deviceId);
    if (!(await this.accounts.needsDeviceConfirmation(member, deviceId))) {
      throw new BadRequestException('This phone is ready. Sign in as usual.');
    }
    const churchName = await this.utilityService.resolveChurchName();
    await this.codes.sendCode(
      member.email,
      DiscuvaAccountCodePurpose.CONFIRM_DEVICE,
      deviceId,
      {
        firstName: member.firstname,
        action: `Someone is signing in to ${churchName} on a phone your Discuva account hasn't used there before. If it's you, enter this code. If not, change your password.`,
      },
    );
  }

  async confirmDevice(
    email: string,
    password: string,
    deviceId: string,
    code: string,
  ): Promise<JwtResponse> {
    await this.assertOn();
    const member = await this.signedInMember(email, password, deviceId);
    if (await this.accounts.needsDeviceConfirmation(member, deviceId)) {
      await this.codes.verifyCode(
        member.email,
        DiscuvaAccountCodePurpose.CONFIRM_DEVICE,
        deviceId,
        code,
      );
      await this.accounts.registerDevice(member, deviceId);
    }
    return this.authService.login(
      {
        id: member.id,
        role: member.role,
        requiresPasswordChange: !member.changedPassword,
        surface: SessionSurface.MEMBER,
      },
      deviceId,
    );
  }

  // The same password check and limits as a normal sign-in.
  private async signedInMember(
    email: string,
    password: string,
    deviceId: string,
  ): Promise<Member> {
    const user = await this.authService.validateMember(
      email,
      password,
      deviceId,
    );
    return this.memberService.getByIdWithCredentials(user.id);
  }

  async available(): Promise<{ available: boolean; profile: boolean }> {
    const [available, profile] = await Promise.all([
      this.accounts.isOn(),
      this.accounts.isProfileOn(),
    ]);
    return { available, profile };
  }

  // What the member app shows on Account and after sign-in.
  async status(memberId: string): Promise<{
    enabled: boolean;
    moved: boolean;
    linkAvailable: boolean;
    email: string;
    profile: boolean;
    needsConsent: boolean;
    detailsToConfirm: DetailToConfirm[];
  }> {
    const member = await this.memberService.getById(memberId);
    const enabled = await this.accounts.isOn();
    const moved = enabled && !!member.discuvaAccountId;
    const linkAvailable =
      enabled && !moved && !!(await this.accounts.findByEmail(member.email));
    const profile = moved && !!(await this.profiles.ownerOf(member));
    const [link, detailsToConfirm] = profile
      ? await Promise.all([
          this.accounts.linkHere(member.id),
          this.profiles.reconcile(member),
        ])
      : [null, []];
    return {
      enabled,
      moved,
      linkAvailable,
      email: member.email,
      profile,
      needsConsent: profile && !link?.consentedAt,
      detailsToConfirm,
    };
  }

  async consent(memberId: string): Promise<void> {
    await this.assertProfileOn(memberId);
    await this.accounts.recordConsent(memberId);
  }

  async confirmDetails(
    memberId: string,
    choices: Record<string, DetailChoice>,
  ): Promise<void> {
    const member = await this.assertProfileOn(memberId);
    await this.profiles.resolve(member, choices);
  }

  private async assertProfileOn(memberId: string): Promise<Member> {
    const member = await this.memberService.getById(memberId);
    if (!(await this.profiles.ownerOf(member))) {
      throw new NotFoundException('This is not available yet.');
    }
    return member;
  }

  // Joining or adding a church shares the person's profile with it, so they agree first.
  private async assertConsent(consent: boolean | undefined): Promise<void> {
    if (consent || !(await this.accounts.isProfileOn())) return;
    const churchName = await this.utilityService.resolveChurchName();
    throw new BadRequestException(
      `Please agree to share your Discuva profile with ${churchName}.`,
    );
  }

  // The profile once there is one, otherwise the church the person joined first.
  private async basicsOf(accountId: string): Promise<Partial<Member> | null> {
    return (
      (await this.profiles.basicsFor(accountId)) ??
      (await this.accounts.basicsFrom(accountId))
    );
  }

  async signOutEverywhere(memberId: string): Promise<void> {
    const member = await this.memberService.getById(memberId);
    await this.accounts.endSessionsEverywhere(member);
  }

  async freeze(accountId: string, token: string): Promise<void> {
    await this.accounts.freezeWithLink(accountId, token);
    this.auditLogService.log('ACCOUNT_FROZEN', { metadata: { accountId } });
  }

  async undoEmail(accountId: string, token: string): Promise<void> {
    const restored = await this.accounts.undoEmailChange(accountId, token);
    this.auditLogService.log('ACCOUNT_EMAIL_UNDONE', {
      targetEmail: restored,
      metadata: { accountId },
    });
  }

  private async linkCandidate(
    memberId: string,
  ): Promise<{ member: Member; account: DiscuvaAccount }> {
    const member = await this.memberService.getByIdWithCredentials(memberId);
    if (member.discuvaAccountId) {
      throw new ConflictException(
        'This church is already on your Discuva account.',
      );
    }
    const account = await this.accounts.findByEmail(member.email);
    if (!account) {
      throw new NotFoundException(
        'There is no Discuva account for your email yet.',
      );
    }
    this.assertNotFrozen(account);
    return { member, account };
  }

  private async movedAccount(memberId: string): Promise<DiscuvaAccount> {
    await this.assertOn();
    const member = await this.memberService.getById(memberId);
    const account = member.discuvaAccountId
      ? await this.accounts.findById(member.discuvaAccountId)
      : null;
    if (!account) {
      throw new NotFoundException("You don't have a Discuva account yet.");
    }
    return account;
  }

  private assertNotFrozen(account: DiscuvaAccount): void {
    if (account.frozenAt) {
      throw new ForbiddenException(
        'This Discuva account is frozen. Reset your password to use it again.',
      );
    }
  }

  private linkDevice(member: Member): string {
    return member.deviceId ?? `member:${member.id}`;
  }

  private definedBasics(basics: Partial<Member> | null): Partial<SignupDto> {
    if (!basics) return {};
    const out: Record<string, unknown> = {};
    for (const key of [
      'phoneNumber',
      'gender',
      'birthDay',
      'birthMonth',
      'birthYear',
      'maritalStatus',
      'address',
      'emergencyContactName',
      'emergencyContactPhone',
      'emergencyContactRelationship',
    ] as const) {
      if (basics[key] !== null && basics[key] !== undefined)
        out[key] = basics[key];
    }
    return out as Partial<SignupDto>;
  }

  private async assertOn(): Promise<void> {
    if (!(await this.accounts.isOn())) {
      throw new NotFoundException('This is not available yet.');
    }
  }

  private joinKey(token: string): string {
    return `account_join:${token}`;
  }

  private handoffKey(token: string): string {
    return `account_handoff:${token}`;
  }
}
