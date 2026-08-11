import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { Admin } from '../../admin/entity/admin.entity';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { forEachActiveTenant } from '../../tenant/utility/for-each-active-tenant';
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
// admin. forEachActiveTenant (already proven by SubscriptionLapseScheduler)
// re-enters each tenant's own schema so the admin lookup below is genuinely
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

  async broadcastToAllTenantAdmins(
    subject: string,
    html: string,
  ): Promise<BroadcastResult> {
    let sent = 0;
    let skipped = 0;

    const { failed } = await forEachActiveTenant(
      this.tenantRepo,
      this.cls,
      this.txHost,
      this.logger,
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

    this.logger.log(
      `Broadcast "${subject}": ${sent} sent, ${skipped} skipped (no admin), ${failed} failed`,
    );
    return { sent, skipped, failed };
  }

  async broadcastPlainTextToAllTenantAdmins(
    subject: string,
    message: string,
  ): Promise<BroadcastResult> {
    return this.broadcastToAllTenantAdmins(subject, plainTextToHtml(message));
  }
}
