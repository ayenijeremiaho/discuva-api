import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { Admin } from '../../admin/entity/admin.entity';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { runInTenantContext } from '../../tenant/utility/run-in-tenant-context';
import { EmailQueueService } from '../../utility/service/email-queue.service';

export interface BroadcastResult {
  sent: number;
  skipped: number;
  failed: number;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Plain text -> one <p> per non-empty line, everything escaped. Deliberately
// not accepting raw HTML from callers of the plain-text-message entry point
// (broadcastPlainTextToAllTenantAdmins) — a platform admin typing into a
// form textarea shouldn't be able to inject arbitrary markup into an email
// that reaches every church on the platform at once. Internal callers that
// need real HTML (e.g. a provider-outage notice with a link) use
// broadcastToAllTenantAdmins directly instead, same as every other
// queueEmail call site in this codebase.
function plainTextToHtml(message: string): string {
  return message
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('\n');
}

// One individual email per tenant, never a single batched `to: [...]` call —
// confirmed live in EmailProcessor that an array `to` produces one shared,
// mutually-visible "To:" header (`Array.isArray(to) ? to.join(', ') : to`),
// which would leak every church admin's email address to every other church
// admin. Each tenant is entered via runInTenantContext (the same primitive
// forEachActiveTenant itself uses) so the admin lookup below is genuinely
// scoped per tenant, not a single global query.
//
// Only the tenant's oldest active admin is notified, same "one primary
// contact" convention SubscriptionLapseScheduler already established for
// platform-initiated notices — not every admin the tenant has.
@Injectable()
export class TenantBroadcastService {
  private readonly logger = new Logger(TenantBroadcastService.name);

  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly cls: ClsService<AppClsStore>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly emailQueueService: EmailQueueService,
  ) {}

  private async sendToTenants(
    tenants: Tenant[],
    subject: string,
    html: string,
  ): Promise<BroadcastResult> {
    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const tenant of tenants) {
      try {
        await runInTenantContext(
          this.cls,
          this.txHost,
          { tenantId: tenant.id, schemaName: tenant.schemaName },
          async () => {
            const admin = await this.txHost.tx.findOne(Admin, {
              where: { isActive: true },
              relations: ['member'],
              order: { createdAt: 'ASC' },
            });
            const email = admin?.member?.email;
            if (!email) {
              skipped++;
              return;
            }
            this.emailQueueService.queueEmail(email, subject, html);
            sent++;
          },
        );
      } catch (err: any) {
        failed++;
        this.logger.warn(
          `Failed for tenant "${tenant.subdomain}": ${err?.message ?? err}`,
        );
      }
    }

    this.logger.log(
      `"${subject}": ${sent} sent, ${skipped} skipped (no admin), ${failed} failed, ${tenants.length} tenants targeted`,
    );
    return { sent, skipped, failed };
  }

  async broadcastToAllTenantAdmins(
    subject: string,
    html: string,
  ): Promise<BroadcastResult> {
    const tenants = await this.tenantRepo.find({ where: { isActive: true } });
    return this.sendToTenants(tenants, subject, html);
  }

  async broadcastPlainTextToAllTenantAdmins(
    subject: string,
    message: string,
  ): Promise<BroadcastResult> {
    return this.broadcastToAllTenantAdmins(subject, plainTextToHtml(message));
  }

  // Targeted variant — e.g. "every tenant currently configured against the
  // communication provider a platform admin just deactivated", not every
  // tenant on the platform. Silently returns a zero result for an empty
  // list rather than querying with an empty IN(), which some drivers treat
  // as "match nothing" and others as a syntax error — not worth relying on
  // either behavior.
  async notifyTenants(
    tenantIds: string[],
    subject: string,
    html: string,
  ): Promise<BroadcastResult> {
    if (tenantIds.length === 0) return { sent: 0, skipped: 0, failed: 0 };
    const tenants = await this.tenantRepo.findBy({
      id: In(tenantIds),
      isActive: true,
    });
    return this.sendToTenants(tenants, subject, html);
  }
}
