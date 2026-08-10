import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import {
  BranchLinkRequestStatus,
  TenantBranchLinkRequest,
} from '../entity/tenant-branch-link-request.entity';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { Subscription } from '../../billing/entity/subscription.entity';
import { SubscriptionStatus } from '../../billing/enum/subscription-status.enum';
import { Admin } from '../../admin/entity/admin.entity';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { runInTenantContext } from '../../tenant/utility/run-in-tenant-context';
import { EmailQueueService } from '../../utility/service/email-queue.service';
import { CacheService } from '../../utility/service/cache.service';

// The entity only stores tenant IDs — the frontend needs names/subdomains
// to be usable, so list reads are enriched with a batch tenant lookup
// rather than exposing raw UUIDs to either side of the negotiation.
export interface BranchLinkRequestView {
  id: string;
  parentTenantId: string;
  parentTenantName: string;
  targetTenantId: string;
  targetTenantName: string;
  targetTenantSubdomain: string;
  status: BranchLinkRequestStatus;
  sponsorPlan: boolean;
  respondedAt: Date | null;
  createdAt: Date;
}

// Sibling of BranchInviteService, for the case an invite can't cover: both
// churches already exist as separate onboarded tenants. Since there's no
// signup step to attach a token to, this is a two-sided negotiation between
// existing tenants instead — the parent creates a request, and only the
// TARGET tenant's own admin (via its own tenant context) can accept or
// decline it. Nothing about either tenant changes until an explicit accept.
@Injectable()
export class BranchLinkRequestService {
  constructor(
    private readonly cls: ClsService<AppClsStore>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly emailQueueService: EmailQueueService,
    private readonly cacheService: CacheService,
    @InjectRepository(TenantBranchLinkRequest)
    private readonly linkRequestRepo: Repository<TenantBranchLinkRequest>,
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

  async createLinkRequest(
    targetSubdomain: string,
    sponsorPlan = false,
  ): Promise<TenantBranchLinkRequest> {
    const parentTenantId = this.currentTenantId();
    const parentTenant = await this.tenantRepo.findOneByOrFail({
      id: parentTenantId,
    });

    const target = await this.tenantRepo.findOneBy({
      subdomain: targetSubdomain.toLowerCase().trim(),
    });
    if (!target) {
      throw new NotFoundException('No church found with that subdomain.');
    }
    if (target.id === parentTenantId) {
      throw new BadRequestException(
        'A church cannot link itself as its own branch.',
      );
    }
    if (target.parentTenantId) {
      throw new BadRequestException(
        'That church is already linked to a parent.',
      );
    }

    const existingPending = await this.linkRequestRepo.findOneBy({
      parentTenantId,
      targetTenantId: target.id,
      status: BranchLinkRequestStatus.PENDING,
    });
    if (existingPending) {
      throw new BadRequestException(
        'A pending link request to this church already exists.',
      );
    }

    const request = await this.linkRequestRepo.save(
      this.linkRequestRepo.create({
        parentTenantId,
        targetTenantId: target.id,
        status: BranchLinkRequestStatus.PENDING,
        sponsorPlan,
      }),
    );

    await this.notifyTarget(parentTenant, target, sponsorPlan);

    return request;
  }

  async listOutgoing(): Promise<BranchLinkRequestView[]> {
    const parentTenantId = this.currentTenantId();
    const requests = await this.linkRequestRepo.find({
      where: { parentTenantId },
      order: { createdAt: 'DESC' },
    });
    return this.enrich(requests);
  }

  async listIncoming(): Promise<BranchLinkRequestView[]> {
    const targetTenantId = this.currentTenantId();
    const requests = await this.linkRequestRepo.find({
      where: { targetTenantId },
      order: { createdAt: 'DESC' },
    });
    return this.enrich(requests);
  }

  private async enrich(
    requests: TenantBranchLinkRequest[],
  ): Promise<BranchLinkRequestView[]> {
    if (!requests.length) return [];

    const tenantIds = Array.from(
      new Set(requests.flatMap((r) => [r.parentTenantId, r.targetTenantId])),
    );
    const tenants = await this.tenantRepo.findBy({ id: In(tenantIds) });
    const tenantById = new Map(tenants.map((t) => [t.id, t]));

    return requests.map((r) => ({
      id: r.id,
      parentTenantId: r.parentTenantId,
      parentTenantName: tenantById.get(r.parentTenantId)?.name ?? 'Unknown',
      targetTenantId: r.targetTenantId,
      targetTenantName: tenantById.get(r.targetTenantId)?.name ?? 'Unknown',
      targetTenantSubdomain: tenantById.get(r.targetTenantId)?.subdomain ?? '',
      status: r.status,
      sponsorPlan: r.sponsorPlan,
      respondedAt: r.respondedAt,
      createdAt: r.createdAt,
    }));
  }

  async revokeLinkRequest(id: string): Promise<TenantBranchLinkRequest> {
    const parentTenantId = this.currentTenantId();
    const request = await this.linkRequestRepo.findOneBy({
      id,
      parentTenantId,
    });
    if (!request) {
      throw new NotFoundException('Link request not found.');
    }
    if (request.status !== BranchLinkRequestStatus.PENDING) {
      throw new BadRequestException(
        'Only a pending link request can be revoked.',
      );
    }
    request.status = BranchLinkRequestStatus.REVOKED;
    request.respondedAt = new Date();
    return this.linkRequestRepo.save(request);
  }

  // Target-side only — the parent cannot accept on the target's behalf.
  async acceptLinkRequest(id: string): Promise<TenantBranchLinkRequest> {
    const targetTenantId = this.currentTenantId();
    const request = await this.linkRequestRepo.findOneBy({
      id,
      targetTenantId,
    });
    if (!request) {
      throw new NotFoundException('Link request not found.');
    }
    if (request.status !== BranchLinkRequestStatus.PENDING) {
      throw new BadRequestException('This link request is no longer pending.');
    }

    const target = await this.tenantRepo.findOneByOrFail({
      id: targetTenantId,
    });
    if (target.parentTenantId) {
      throw new BadRequestException(
        'This church is already linked to a parent.',
      );
    }

    target.parentTenantId = request.parentTenantId;
    await this.tenantRepo.save(target);

    request.status = BranchLinkRequestStatus.ACCEPTED;
    request.respondedAt = new Date();
    await this.linkRequestRepo.save(request);

    if (request.sponsorPlan) {
      await this.applySponsorship(targetTenantId, request.parentTenantId);
    }

    const parentTenant = await this.tenantRepo.findOneBy({
      id: request.parentTenantId,
    });
    if (parentTenant) {
      await this.notifyParent(parentTenant, target, 'accepted');
    }

    return request;
  }

  async declineLinkRequest(id: string): Promise<TenantBranchLinkRequest> {
    const targetTenantId = this.currentTenantId();
    const request = await this.linkRequestRepo.findOneBy({
      id,
      targetTenantId,
    });
    if (!request) {
      throw new NotFoundException('Link request not found.');
    }
    if (request.status !== BranchLinkRequestStatus.PENDING) {
      throw new BadRequestException('This link request is no longer pending.');
    }

    request.status = BranchLinkRequestStatus.DECLINED;
    request.respondedAt = new Date();
    await this.linkRequestRepo.save(request);

    const [parentTenant, target] = await Promise.all([
      this.tenantRepo.findOneBy({ id: request.parentTenantId }),
      this.tenantRepo.findOneBy({ id: targetTenantId }),
    ]);
    if (parentTenant && target) {
      await this.notifyParent(parentTenant, target, 'declined');
    }

    return request;
  }

  // Only applies the parent's plan if the parent currently has something
  // worth sponsoring onto — same fallback as BranchInviteService.resolveInvite:
  // a parent on Free leaves the target's existing subscription untouched
  // rather than erroring, since sponsorPlan was only ever a request, not a
  // guarantee.
  private async applySponsorship(
    tenantId: string,
    parentTenantId: string,
  ): Promise<void> {
    const parentSubscription = await this.subscriptionRepo.findOneBy({
      tenantId: parentTenantId,
    });
    if (!parentSubscription || parentSubscription.planId === 'free') return;

    const subscription = await this.subscriptionRepo.findOneBy({ tenantId });
    if (!subscription) return;

    subscription.planId = parentSubscription.planId;
    subscription.status = SubscriptionStatus.ACTIVE;
    subscription.cancelAtPeriodEnd = false;
    subscription.canceledAt = null;
    subscription.sponsoredByTenantId = parentTenantId;
    await this.subscriptionRepo.save(subscription);
    this.cacheService.del(`plan-features:${tenantId}`);
  }

  private async notifyTarget(
    parentTenant: Tenant,
    target: Tenant,
    sponsorPlan: boolean,
  ): Promise<void> {
    const email = await this.findAdminEmail(target);
    if (!email) return;

    const sponsorNote = sponsorPlan
      ? `<p>If you accept, this church's plan will be sponsored by ${parentTenant.name} — no independent payment required.</p>`
      : '';

    this.emailQueueService.queueEmail(
      email,
      `${parentTenant.name} wants to link your church as a branch`,
      `<p>${parentTenant.name} has sent a request to link your church as a branch on Discuva.</p>
       <p>Review and respond to this request from your church's branch settings.</p>
       ${sponsorNote}`,
    );
  }

  private async notifyParent(
    parentTenant: Tenant,
    target: Tenant,
    outcome: 'accepted' | 'declined',
  ): Promise<void> {
    const email = await this.findAdminEmail(parentTenant);
    if (!email) return;

    const subject =
      outcome === 'accepted'
        ? `${target.name} accepted your branch link request`
        : `${target.name} declined your branch link request`;
    const html =
      outcome === 'accepted'
        ? `<p>${target.name} has accepted your request to join as a branch. It now appears in your branch overview.</p>`
        : `<p>${target.name} has declined your request to join as a branch.</p>`;

    this.emailQueueService.queueEmail(email, subject, html);
  }

  // Same manual tenant-context-entry pattern as
  // SubscriptionLapseScheduler.findAdminEmail — this service runs on behalf
  // of whichever tenant issued the request, but the notification recipient
  // lives in the OTHER tenant's schema, which has no ambient CLS context to
  // inherit here.
  private async findAdminEmail(tenant: Tenant): Promise<string | null> {
    const admin = await runInTenantContext(
      this.cls,
      this.txHost,
      { tenantId: tenant.id, schemaName: tenant.schemaName },
      () =>
        this.txHost.tx.findOne(Admin, {
          where: { isActive: true },
          relations: ['member'],
          order: { createdAt: 'ASC' },
        }),
    );
    return admin?.member?.email ?? null;
  }
}
