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
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { runInTenantContext } from '../../tenant/utility/run-in-tenant-context';
import { Member } from '../../member/entity/member.entity';
import { MemberRoleEnum } from '../../member/enums/member-role.enum';
import { MemberService } from '../../member/service/member.service';
import { MemberSessionService } from '../../member/service/member-session.service';
import { Admin } from '../../admin/entity/admin.entity';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { DiscuvaAccountService } from '../../discuva-account/service/discuva-account.service';
import { DiscuvaProfileService } from '../../discuva-account/service/discuva-profile.service';
import { PushNotificationService } from '../../push-notification/service/push-notification.service';
import { AccountSignInService } from '../../auth/service/account-sign-in.service';
import { SessionSurface } from '../../auth/enum/session-surface.enum';
import { UtilityService } from '../../utility/service/utility.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import {
  NetworkTransfer,
  NetworkTransferStatus,
} from '../entity/network-transfer.entity';
import { NetworkService } from './network.service';
import {
  BranchClosure,
  BranchClosureStatus,
} from '../entity/branch-closure.entity';

type Church = Pick<Tenant, 'id' | 'schemaName' | 'subdomain' | 'networkRootId'>;

export type TransferResult =
  | { status: 'MOVED'; subdomain: string; token: string }
  | { status: 'REQUESTED' };

export interface TransferOptions {
  available: boolean;
  hasAccount: boolean;
  isAdmin: boolean;
  needsRelease: boolean;
  // This branch is closing: where everyone moves on the date unless they choose elsewhere first.
  closure: { closesOn: string; toTenantId: string; toPath: string } | null;
  pending: {
    id: string;
    toTenantId: string;
    toPath: string;
    requestedAt: Date;
  } | null;
}

export interface TransferRequestRow {
  id: string;
  memberId: string;
  name: string;
  photoUrl: string | null;
  toTenantId: string;
  toPath: string;
  requestedAt: Date;
}

// Moving a member's home to another branch of the same network (Phase 4, decision 7).
@Injectable()
export class NetworkTransferService {
  constructor(
    @InjectRepository(NetworkTransfer)
    private readonly transferRepo: Repository<NetworkTransfer>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(Admin)
    private readonly adminRepo: Repository<Admin>,
    @InjectRepository(BranchClosure)
    private readonly closureRepo: Repository<BranchClosure>,
    private readonly network: NetworkService,
    private readonly accounts: DiscuvaAccountService,
    private readonly profiles: DiscuvaProfileService,
    private readonly memberService: MemberService,
    private readonly sessions: MemberSessionService,
    private readonly push: PushNotificationService,
    private readonly signIn: AccountSignInService,
    private readonly utility: UtilityService,
    private readonly auditLog: AuditLogService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {}

  async options(memberId: string): Promise<TransferOptions> {
    const [available, member, here] = await Promise.all([
      this.network.isAvailable(),
      this.memberService.getById(memberId),
      this.here(),
    ]);
    const pending = member.discuvaAccountId
      ? await this.pendingFor(member.discuvaAccountId)
      : null;
    const closure = await this.closingNow(here.id);
    const pathIds = [pending?.toTenantId, closure?.destinationTenantId].filter(
      (id): id is string => !!id,
    );
    const paths =
      pathIds.length && here.networkRootId
        ? await this.network.pathsOf(here.networkRootId, pathIds)
        : new Map<string, string>();
    return {
      available: available && !!here.networkRootId,
      hasAccount: !!member.discuvaAccountId,
      isAdmin: await this.isAdmin(memberId),
      needsRelease: member.role === MemberRoleEnum.WORKER && !closure,
      closure: closure && {
        closesOn: closure.closesOn,
        toTenantId: closure.destinationTenantId,
        toPath: paths.get(closure.destinationTenantId) ?? '',
      },
      pending: pending && {
        id: pending.id,
        toTenantId: pending.toTenantId,
        toPath: paths.get(pending.toTenantId) ?? '',
        requestedAt: pending.requestedAt,
      },
    };
  }

  // Members move at once; workers wait for this branch to release them.
  async request(memberId: string, toTenantId: string): Promise<TransferResult> {
    if (!(await this.network.isAvailable())) {
      throw new NotFoundException('Moving branches is not available yet.');
    }
    const member = await this.memberService.getById(memberId);
    if (!member.discuvaAccountId) {
      throw new BadRequestException(
        'Set up Discuva sign-in first, then you can move branches.',
      );
    }
    const here = await this.here();
    const target = await this.tenantRepo.findOne({
      where: { id: toTenantId, isActive: true },
      select: { id: true, networkRootId: true },
    });
    if (
      !here.networkRootId ||
      !target ||
      target.networkRootId !== here.networkRootId
    ) {
      throw new BadRequestException('Choose a branch in your network.');
    }
    if (target.id === here.id) {
      throw new BadRequestException('This is already your branch.');
    }
    if (await this.isAdmin(memberId)) {
      throw new ForbiddenException(
        "You're an admin here. Ask an owner to remove your admin access first, then move.",
      );
    }
    if (await this.pendingFor(member.discuvaAccountId)) {
      throw new ConflictException(
        'You already asked to move. Cancel that request to choose another branch.',
      );
    }

    const transfer = this.transferRepo.create({
      networkRootId: here.networkRootId,
      accountId: member.discuvaAccountId,
      fromTenantId: here.id,
      toTenantId: target.id,
      fromMemberId: member.id,
      status: NetworkTransferStatus.PENDING,
      // A closing branch has nobody left to release workers, so they move like everyone else.
      needsRelease:
        member.role === MemberRoleEnum.WORKER &&
        !(await this.closingNow(here.id)),
    });

    if (transfer.needsRelease) {
      await this.transferRepo.save(transfer);
      this.auditLog.log('TRANSFER_REQUESTED', {
        actorId: member.id,
        targetId: member.id,
        targetEmail: member.email,
      });
      const paths = await this.network.pathsOf(here.networkRootId, [target.id]);
      await this.emailAdmins(
        'network-transfer-request',
        `${this.fullName(member)} Asks to Move Branch`,
        {
          member_name: this.fullName(member),
          to_church: paths.get(target.id) ?? '',
        },
      );
      return { status: 'REQUESTED' };
    }

    await this.execute(transfer, null);
    const { subdomain, token } = await this.signIn.switchChurch(
      member.id,
      target.id,
    );
    return { status: 'MOVED', subdomain, token };
  }

  async cancel(memberId: string): Promise<void> {
    const { affected } = await this.transferRepo.update(
      {
        fromMemberId: memberId,
        fromTenantId: this.tenantId(),
        status: NetworkTransferStatus.PENDING,
      },
      { status: NetworkTransferStatus.CANCELLED, decidedAt: new Date() },
    );
    if (!affected) throw new NotFoundException('No request to cancel.');
  }

  // Admin: workers from this branch waiting to be released.
  async pendingHere(): Promise<TransferRequestRow[]> {
    const rows = await this.transferRepo.find({
      where: {
        fromTenantId: this.tenantId(),
        status: NetworkTransferStatus.PENDING,
      },
      order: { requestedAt: 'ASC' },
    });
    if (!rows.length) return [];
    const [members, paths] = await Promise.all([
      this.memberService.findByIds(rows.map((r) => r.fromMemberId)),
      this.network.pathsOf(
        rows[0].networkRootId,
        rows.map((r) => r.toTenantId),
      ),
    ]);
    const byId = new Map(members.map((m) => [m.id, m]));
    return rows.map((r) => {
      const m = byId.get(r.fromMemberId);
      return {
        id: r.id,
        memberId: r.fromMemberId,
        name: m ? this.fullName(m) : 'Former member',
        photoUrl: m?.photoUrl ?? null,
        toTenantId: r.toTenantId,
        toPath: paths.get(r.toTenantId) ?? '',
        requestedAt: r.requestedAt,
      };
    });
  }

  async release(id: string, actorMemberId: string): Promise<void> {
    const transfer = await this.pendingHereById(id);
    if (transfer.fromMemberId === actorMemberId) {
      throw new ForbiddenException('Another admin needs to release you.');
    }
    await this.execute(transfer, actorMemberId);
    this.auditLog.log('TRANSFER_RELEASED', {
      actorId: actorMemberId,
      targetId: transfer.fromMemberId,
    });
  }

  async decline(
    id: string,
    actorMemberId: string,
    reason?: string,
  ): Promise<void> {
    const transfer = await this.pendingHereById(id);
    transfer.status = NetworkTransferStatus.DECLINED;
    transfer.decidedAt = new Date();
    transfer.decidedByMemberId = actorMemberId;
    transfer.declineReason = reason?.trim() || null;
    await this.transferRepo.save(transfer);
    this.auditLog.log('TRANSFER_DECLINED', {
      actorId: actorMemberId,
      targetId: transfer.fromMemberId,
    });
    const [member, account, paths] = await Promise.all([
      this.memberService.getById(transfer.fromMemberId),
      this.accounts.findById(transfer.accountId),
      this.network.pathsOf(transfer.networkRootId, [transfer.toTenantId]),
    ]);
    if (!account) return;
    const name = UtilityService.capitalizeFirstLetter(member.firstname);
    this.utility.sendEmailWithTemplate(
      account.email,
      `${name}, Your Move Wasn't Approved Yet`,
      'network-transfer-declined',
      {
        name,
        to_church: paths.get(transfer.toTenantId) ?? '',
        note: transfer.declineReason,
      },
    );
  }

  // New branch first, so a failure part-way leaves the old record untouched and a retry reuses the new one.
  // A branch closing moves everyone with an account the ordinary way; its admins get one summary, not one email each.
  async moveForClosure(
    memberId: string,
    accountId: string,
    fromTenantId: string,
    toTenantId: string,
    rootId: string,
  ): Promise<void> {
    const transfer = this.transferRepo.create({
      networkRootId: rootId,
      accountId,
      fromTenantId,
      toTenantId,
      fromMemberId: memberId,
      status: NetworkTransferStatus.PENDING,
      needsRelease: false,
    });
    await this.execute(transfer, null, { quiet: true });
  }

  private async execute(
    transfer: NetworkTransfer,
    actorId: string | null,
    { quiet = false }: { quiet?: boolean } = {},
  ): Promise<void> {
    const from = await this.memberService.getByIdWithCredentials(
      transfer.fromMemberId,
    );
    const account = await this.accounts.findById(transfer.accountId);
    if (!account)
      throw new BadRequestException('Their Discuva account is gone.');
    const churches = await this.tenantRepo.find({
      where: {
        id: In([transfer.fromTenantId, transfer.toTenantId]),
        isActive: true,
      },
      select: {
        id: true,
        schemaName: true,
        subdomain: true,
        networkRootId: true,
      },
    });
    const target = churches.find((c) => c.id === transfer.toTenantId);
    if (!target || target.networkRootId !== transfer.networkRootId) {
      throw new BadRequestException('That branch is no longer open.');
    }
    const [subscription, link, paths] = await Promise.all([
      this.push.subscriptionOf(from.id),
      this.accounts.linkHere(from.id),
      this.network.pathsOf(transfer.networkRootId, [
        transfer.fromTenantId,
        transfer.toTenantId,
      ]),
    ]);
    const fromPath = paths.get(transfer.fromTenantId) ?? '';
    const toPath = paths.get(transfer.toTenantId) ?? '';
    const joinedOn = from.dateJoinedChurch ?? from.createdAt;

    const arrived = await this.inChurch(target, async () => {
      const existing = (await this.accounts.linksOf(account.id)).find(
        (l) => l.tenantId === target.id,
      );
      let member: Member;
      if (existing) {
        member = await this.memberService.welcomeBack(existing.memberId);
      } else {
        try {
          member = await this.memberService.createFromTransfer(
            from,
            account,
            from.deviceId,
            joinedOn,
          );
        } catch (err) {
          if (err instanceof ConflictException) {
            throw new ConflictException(
              `${toPath} already has a record with this email. Please ask their admins to help.`,
            );
          }
          throw err;
        }
        await this.accounts.link(account.id, member.id, !!link?.consentedAt);
      }
      if (await this.profiles.ownerOf(member))
        await this.profiles.reconcile(member);
      if (subscription) {
        await this.push.subscribe(member.id, {
          endpoint: subscription.endpoint,
          p256dh: subscription.p256dh,
          auth: subscription.auth,
        });
      }
      // Sent from the new branch, so it carries that branch's look.
      const name = UtilityService.capitalizeFirstLetter(from.firstname);
      this.utility.sendEmailWithTemplate(
        account.email,
        `${name}, You've Moved to ${toPath}`,
        'network-transfer-moved',
        { name, from_church: fromPath, to_church: toPath },
      );
      if (!quiet)
        await this.emailAdmins(
          'network-transfer-arrived',
          `${this.fullName(from)} Moved to Your Branch`,
          {
            member_name: this.fullName(from),
            from_church: fromPath,
          },
        );
      return member;
    });

    await this.accounts.setHome(account.id, transfer.networkRootId, target.id);
    transfer.status = NetworkTransferStatus.DONE;
    transfer.toMemberId = arrived.id;
    transfer.decidedAt = new Date();
    transfer.decidedByMemberId = actorId;
    await this.transferRepo.save(transfer);

    await this.memberService.markTransferred(from.id, target.id);
    await this.push.unsubscribe(from.id);
    await this.sessions.updateLogout(from.id, SessionSurface.MEMBER);

    if (!quiet)
      await this.emailAdmins(
        'network-transfer-left',
        `${this.fullName(from)} Moved to Another Branch`,
        {
          member_name: this.fullName(from),
          to_church: toPath,
        },
      );
  }

  private inChurch<T>(church: Church, fn: () => Promise<T>): Promise<T> {
    return runInTenantContext(
      this.cls,
      this.txHost,
      { tenantId: church.id, schemaName: church.schemaName },
      fn,
    );
  }

  // Owners and admins who manage members, at whichever church is current. Awaited: the lookup needs that church's schema.
  private async emailAdmins(
    template: string,
    subject: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const admins = await this.adminRepo
      .createQueryBuilder('a')
      .innerJoin('a.member', 'm')
      .leftJoin('a.adminRole', 'role')
      .select(['a.id', 'a.isOwner', 'm.email', 'role.permissions'])
      .where('a.isActive = true')
      .getMany();
    const emails = admins
      .filter(
        (a) =>
          a.isOwner ||
          a.adminRole?.permissions?.includes(AdminPermission.MEMBERS_WRITE),
      )
      .map((a) => a.member.email);
    for (const email of new Set(emails)) {
      this.utility.sendEmailWithTemplate(email, subject, template, data);
    }
  }

  private closingNow(tenantId: string): Promise<BranchClosure | null> {
    return this.closureRepo.findOne({
      where: {
        tenantId,
        status: In([
          BranchClosureStatus.SCHEDULED,
          BranchClosureStatus.RUNNING,
        ]),
      },
    });
  }

  private async isAdmin(memberId: string): Promise<boolean> {
    return this.adminRepo.exists({
      where: { member: { id: memberId }, isActive: true },
    });
  }

  private pendingFor(accountId: string): Promise<NetworkTransfer | null> {
    return this.transferRepo.findOne({
      where: { accountId, status: NetworkTransferStatus.PENDING },
    });
  }

  private async pendingHereById(id: string): Promise<NetworkTransfer> {
    const transfer = await this.transferRepo.findOne({
      where: {
        id,
        fromTenantId: this.tenantId(),
        status: NetworkTransferStatus.PENDING,
      },
    });
    if (!transfer)
      throw new NotFoundException('This request was already handled.');
    return transfer;
  }

  private async here(): Promise<Tenant> {
    const tenant = await this.tenantRepo.findOne({
      where: { id: this.tenantId() },
      select: { id: true, networkRootId: true },
    });
    if (!tenant) throw new NotFoundException('Church not found.');
    return tenant;
  }

  private tenantId(): string {
    return this.cls.get('tenantId');
  }

  private fullName(m: Pick<Member, 'firstname' | 'lastname'>): string {
    return [m.firstname, m.lastname].filter(Boolean).join(' ');
  }
}
