import { FREE_PLAN_IDS } from '../../billing/util/free-plan.util';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bull';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bull';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Tenant } from '../entity/tenant.entity';
import { TenantOnboardingStatus } from '../enum/tenant-onboarding-status.enum';
import { PlatformSettingsService } from '../../platform-admin/service/platform-settings.service';
import { PlatformSettingKey } from '../../platform-admin/enum/platform-setting-key.enum';
import { CacheService } from '../../utility/service/cache.service';
import { UtilityService } from '../../utility/service/utility.service';
import {
  ACCOUNT_FILE_CLEANUP_OPTIONS,
  ACCOUNT_FILE_CLEANUP_QUEUE,
  AccountFileCleanupJobData,
} from '../processor/account-file-cleanup.processor';

const DAY_MS = 24 * 60 * 60 * 1000;
const WARN_DAYS_BEFORE_ARCHIVE = 7;
const RUN_ONCE_SECONDS = 3600;
const BATCH = 200;
const SAFE_SCHEMA = /^[a-z_][a-z0-9_]*$/;
// Only columns the server fills from its own uploads, never a value a request could choose.
const FILE_ID_COLUMNS = [
  ['class_materials', 'public_id'],
  ['finance_requests', 'attachment_public_id'],
  ['finance_requests', 'proof_public_id'],
  ['form_field_attachments', 'public_id'],
  ['forms', 'cover_image_public_id'],
  ['forms', 'logo_public_id'],
  ['members', 'photo_public_id'],
  ['pages', 'draft_og_image_public_id'],
  ['pages', 'og_image_public_id'],
  ['social_post_media', 'public_id'],
  ['tithe_payment_proofs', 'public_id'],
];

interface RequestDetails {
  adminEmail?: string;
  contactEmail?: string;
}

// Reads only the public tenants table, once a day. Verified accounts, paid plans and networks are never touched.
@Injectable()
export class AccountLifecycleScheduler {
  private readonly logger = new Logger(AccountLifecycleScheduler.name);

  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly settings: PlatformSettingsService,
    private readonly cacheService: CacheService,
    private readonly utilityService: UtilityService,
    @InjectQueue(ACCOUNT_FILE_CLEANUP_QUEUE)
    private readonly fileCleanup: Queue<AccountFileCleanupJobData>,
  ) {}

  @Cron('30 3 * * *')
  async run(now = new Date()): Promise<void> {
    if (
      !(await this.cacheService.acquireLock(
        'lock:account-lifecycle',
        RUN_ONCE_SECONDS,
      ))
    ) {
      return;
    }
    const archiveDays = await this.settings.getNumber(
      PlatformSettingKey.ACCOUNT_ARCHIVE_AFTER_DAYS,
    );
    const deleteDays = Math.max(
      await this.settings.getNumber(
        PlatformSettingKey.ACCOUNT_DELETE_AFTER_DAYS,
      ),
      archiveDays + 1,
    );

    await this.warn(now, archiveDays, deleteDays);
    await this.archive(now, archiveDays, deleteDays);
    if (await this.settings.getNumber(PlatformSettingKey.ACCOUNT_AUTO_DELETE)) {
      await this.deleteExpired(now, deleteDays);
    }
  }

  private candidates(lastActiveBefore: Date) {
    return this.tenantRepo
      .createQueryBuilder('t')
      .where('t.verifiedAt IS NULL')
      .andWhere(`t.onboardingStatus = '${TenantOnboardingStatus.ACTIVE}'`)
      .andWhere('t.lastActiveAt <= :lastActiveBefore', { lastActiveBefore })
      .andWhere('t.parentTenantId IS NULL')
      .andWhere(
        `NOT EXISTS (SELECT 1 FROM tenants child WHERE child.parent_tenant_id = t.id)`,
      )
      .andWhere(
        `NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.tenant_id = t.id AND s.plan_id NOT IN (${FREE_PLAN_IDS.map((id) => `'${id}'`).join(', ')}))`,
      )
      .take(BATCH);
  }

  private async warn(now: Date, archiveDays: number, deleteDays: number) {
    const due = await this.candidates(
      new Date(
        now.getTime() - (archiveDays - WARN_DAYS_BEFORE_ARCHIVE) * DAY_MS,
      ),
    )
      .andWhere('t.inactivityWarnedAt IS NULL')
      .getMany();
    for (const tenant of due) {
      await this.tenantRepo.update(tenant.id, { inactivityWarnedAt: now });
      this.notify(
        tenant,
        `${tenant.name} will be archived soon`,
        `Nobody has signed in to ${tenant.name} for a while. It will be archived in ${WARN_DAYS_BEFORE_ARCHIVE} days, and permanently deleted ${deleteDays - archiveDays} days after that. Sign in to keep it.`,
      );
    }
  }

  private async archive(now: Date, archiveDays: number, deleteDays: number) {
    const due = await this.candidates(
      new Date(now.getTime() - archiveDays * DAY_MS),
    )
      .andWhere('t.archivedAt IS NULL')
      .getMany();
    for (const tenant of due) {
      await this.tenantRepo.update(tenant.id, { archivedAt: now });
      this.notify(
        tenant,
        `${tenant.name} has been archived`,
        `${tenant.name} has been archived because nobody has signed in for ${archiveDays} days. It will be permanently deleted in ${deleteDays - archiveDays} days. Sign in before then to keep it.`,
      );
    }
  }

  // Skips anything archived too recently, so nobody loses the notice period if the settings change.
  private async deleteExpired(now: Date, deleteDays: number) {
    const due = await this.candidates(
      new Date(now.getTime() - deleteDays * DAY_MS),
    )
      .andWhere('t.archivedAt IS NOT NULL')
      .andWhere('t.archivedAt <= :noticeBefore', {
        noticeBefore: new Date(now.getTime() - DAY_MS),
      })
      .getMany();
    for (const tenant of due) {
      let legacyPublicIds: string[];
      if (!SAFE_SCHEMA.test(tenant.schemaName)) {
        this.logger.error(`Refusing to delete schema for tenant ${tenant.id}`);
        continue;
      }
      try {
        legacyPublicIds = await this.dataSource.transaction(async (manager) => {
          const ids = await this.fileIds(manager, tenant);
          await this.removeSharedRecords(manager, tenant);
          await manager.query(
            `DROP SCHEMA IF EXISTS "${tenant.schemaName}" CASCADE`,
          );
          await manager.delete(Tenant, { id: tenant.id });
          return ids;
        });
        this.logger.warn(
          `Deleted inactive account "${tenant.subdomain}" (${tenant.id})`,
        );
        this.notify(
          tenant,
          'Your account has been deleted',
          `${tenant.name} has been permanently deleted because nobody signed in. Its data and files are removed now, and any copies in our backups expire on their normal schedule. You're welcome to set it up again at any time.`,
        );
      } catch (err) {
        this.logger.error(
          `Could not delete account ${tenant.id}: ${(err as Error).message}`,
        );
        continue;
      }
      this.cleanUpAfterDelete(tenant.id, legacyPublicIds);
    }
  }

  private async fileIds(
    manager: EntityManager,
    tenant: Tenant,
  ): Promise<string[]> {
    const selects = FILE_ID_COLUMNS.map(
      ([table, column]) =>
        `SELECT ${column} AS id FROM "${tenant.schemaName}".${table} WHERE ${column} IS NOT NULL`,
    );
    const rows: { id: string }[] = await manager.query(
      `${selects.join(' UNION ')}
       UNION SELECT image_public_id FROM public.tenant_asset_overrides WHERE tenant_id = $1
       UNION SELECT logo_public_id FROM public.tenants WHERE id = $1 AND logo_public_id IS NOT NULL`,
      [tenant.id],
    );
    return rows.map((row) => row.id);
  }

  // These live outside the schema with no link that cascades. Logs need both address and name, as one address can run several churches.
  private async removeSharedRecords(
    manager: EntityManager,
    tenant: Tenant,
  ): Promise<void> {
    await manager.query(
      `DELETE FROM public.feature_usages WHERE tenant_id = $1`,
      [tenant.id],
    );
    const details = tenant.requestDetails as RequestDetails | null;
    const addresses = [details?.adminEmail, details?.contactEmail].filter(
      Boolean,
    );
    if (addresses.length) {
      await manager.query(
        `DELETE FROM public.email_logs WHERE recipient = ANY($1) AND position($2 in subject) > 0`,
        [addresses, tenant.name],
      );
    }
  }

  // The database delete has already committed, so failures here are logged and never undo it.
  private cleanUpAfterDelete(
    tenantId: string,
    legacyPublicIds: string[],
  ): void {
    this.fileCleanup
      .add({ tenantId, legacyPublicIds }, ACCOUNT_FILE_CLEANUP_OPTIONS)
      .catch((err: Error) =>
        this.logger.error(
          `Could not queue file cleanup for ${tenantId}: ${err.message}`,
        ),
      );
    this.cacheService
      .flushTenant(tenantId)
      .catch((err: Error) =>
        this.logger.warn(
          `Could not clear cache for ${tenantId}: ${err.message}`,
        ),
      );
  }

  private notify(tenant: Tenant, heading: string, message: string): void {
    const details = tenant.requestDetails as RequestDetails | null;
    if (!details?.adminEmail) return;
    this.utilityService.sendEmailWithTemplate(
      details.adminEmail,
      heading,
      'account-lifecycle-notice',
      { heading, message },
    );
  }
}
