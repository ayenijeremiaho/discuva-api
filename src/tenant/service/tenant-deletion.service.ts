import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { InjectDataSource } from '@nestjs/typeorm';
import { Queue } from 'bull';
import { DataSource, EntityManager } from 'typeorm';
import { Tenant } from '../entity/tenant.entity';
import { CacheService } from '../../utility/service/cache.service';
import {
  ACCOUNT_FILE_CLEANUP_OPTIONS,
  ACCOUNT_FILE_CLEANUP_QUEUE,
  AccountFileCleanupJobData,
} from '../processor/account-file-cleanup.processor';

const SAFE_SCHEMA = /^[a-z_][a-z0-9_]*$/;
export const isSafeSchema = (name: string) => SAFE_SCHEMA.test(name);
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

// Permanently removes a church: its schema, its row (links cascade), shared records, cache and stored files.
@Injectable()
export class TenantDeletionService {
  private readonly logger = new Logger(TenantDeletionService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly cacheService: CacheService,
    @InjectQueue(ACCOUNT_FILE_CLEANUP_QUEUE)
    private readonly fileCleanup: Queue<AccountFileCleanupJobData>,
  ) {}

  async delete(tenant: Tenant): Promise<void> {
    if (!isSafeSchema(tenant.schemaName)) {
      throw new Error(`Refusing to delete schema for tenant ${tenant.id}`);
    }
    const legacyPublicIds = await this.dataSource.transaction(
      async (manager) => {
        const ids = await this.fileIds(manager, tenant);
        await this.removeSharedRecords(manager, tenant);
        await manager.query(
          `DROP SCHEMA IF EXISTS "${tenant.schemaName}" CASCADE`,
        );
        await manager.delete(Tenant, { id: tenant.id });
        return ids;
      },
    );
    this.cleanUpAfterDelete(tenant.id, legacyPublicIds);
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
}
