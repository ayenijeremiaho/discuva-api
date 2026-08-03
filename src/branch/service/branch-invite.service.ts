import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { randomBytes } from 'node:crypto';
import {
  BranchInviteStatus,
  TenantBranchInvite,
} from '../entity/tenant-branch-invite.entity';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { Subscription } from '../../billing/entity/subscription.entity';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { EmailQueueService } from '../../utility/service/email-queue.service';

const INVITE_EXPIRY_DAYS = 7;

export interface ResolvedInvite {
  parentTenantId: string;
  // Set only when the invite's sponsorPlan was true AND the parent
  // currently has a paid (non-free) subscription — a parent on Free has
  // nothing to sponsor the branch onto, so this falls back to the normal
  // free-signup behavior rather than erroring.
  sponsoredPlanId: string | null;
}

// Onboarding a branch (docs/MULTI_TENANT_MIGRATION.md §11.1): 1) parent
// admin sends an invite (this service), 2) invited church signs up
// normally via POST /signup with the invite token attached, 3) only on
// successful signup is the new tenant's row stamped with the parent's id —
// an unaccepted invite has no data visibility either direction, since the
// branch tenant simply doesn't exist yet.
@Injectable()
export class BranchInviteService {
  constructor(
    private readonly cls: ClsService<AppClsStore>,
    private readonly emailQueueService: EmailQueueService,
    @InjectRepository(TenantBranchInvite)
    private readonly inviteRepo: Repository<TenantBranchInvite>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(Subscription)
    private readonly subscriptionRepo: Repository<Subscription>,
  ) {}

  private currentTenantId(): string {
    const tenantId = this.cls.get('tenantId');
    if (!tenantId) {
      throw new ForbiddenException('No tenant context for this request.');
    }
    return tenantId;
  }

  async createInvite(
    email: string,
    sponsorPlan = false,
  ): Promise<TenantBranchInvite> {
    const parentTenantId = this.currentTenantId();
    const parentTenant = await this.tenantRepo.findOneByOrFail({
      id: parentTenantId,
    });

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + INVITE_EXPIRY_DAYS);

    const invite = await this.inviteRepo.save(
      this.inviteRepo.create({
        parentTenantId,
        email,
        token,
        status: BranchInviteStatus.PENDING,
        expiresAt,
        sponsorPlan,
      }),
    );

    const sponsorNote = sponsorPlan
      ? `<p>This branch's plan will be sponsored by ${parentTenant.name} — no independent payment required.</p>`
      : '';

    // Fire-and-forget per this codebase's queue convention — the invite row
    // is already durably saved above; the email is a best-effort notification,
    // not the source of truth for the invite existing.
    this.emailQueueService.queueEmail(
      email,
      `You've been invited to join ${parentTenant.name} as a branch`,
      `<p>${parentTenant.name} has invited your church to join as a branch on Discovery Hub.</p>
       <p>When creating your church account, enter this invite code:</p>
       <p style="font-size:1.2em;font-weight:bold;letter-spacing:1px;">${token}</p>
       <p>This code expires in ${INVITE_EXPIRY_DAYS} days.</p>
       ${sponsorNote}`,
    );

    return invite;
  }

  async listInvites(): Promise<TenantBranchInvite[]> {
    const parentTenantId = this.currentTenantId();
    return this.inviteRepo.find({
      where: { parentTenantId },
      order: { createdAt: 'DESC' },
    });
  }

  async revokeInvite(id: string): Promise<TenantBranchInvite> {
    const parentTenantId = this.currentTenantId();
    const invite = await this.inviteRepo.findOneBy({ id, parentTenantId });
    if (!invite) {
      throw new NotFoundException('Invite not found.');
    }
    if (invite.status !== BranchInviteStatus.PENDING) {
      throw new BadRequestException('Only a pending invite can be revoked.');
    }
    invite.status = BranchInviteStatus.REVOKED;
    return this.inviteRepo.save(invite);
  }

  // Called from SignupController before provisioning — validates the token
  // is real, still pending, and not expired, without mutating anything yet
  // (provisioning itself might still fail after this check, e.g. a taken
  // subdomain — the invite should stay usable for a retry).
  async resolveInvite(token: string): Promise<ResolvedInvite> {
    const invite = await this.inviteRepo.findOneBy({ token });
    if (!invite || invite.status !== BranchInviteStatus.PENDING) {
      throw new BadRequestException('Invalid or already-used invite code.');
    }
    if (invite.expiresAt < new Date()) {
      throw new BadRequestException('This invite code has expired.');
    }

    let sponsoredPlanId: string | null = null;
    if (invite.sponsorPlan) {
      const parentSubscription = await this.subscriptionRepo.findOneBy({
        tenantId: invite.parentTenantId,
      });
      if (parentSubscription && parentSubscription.planId !== 'free') {
        sponsoredPlanId = parentSubscription.planId;
      }
    }

    return { parentTenantId: invite.parentTenantId, sponsoredPlanId };
  }

  // Called from SignupController after a successful provision — marks the
  // invite consumed so it can't be reused for a second tenant.
  async markAccepted(token: string, acceptedTenantId: string): Promise<void> {
    await this.inviteRepo.update(
      { token },
      { status: BranchInviteStatus.ACCEPTED, acceptedTenantId },
    );
  }
}
