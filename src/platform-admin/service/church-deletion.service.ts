import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Tenant } from '../../tenant/entity/tenant.entity';
import {
  isSafeSchema,
  TenantDeletionService,
} from '../../tenant/service/tenant-deletion.service';
import { PlatformAdminSecurityEvent } from '../entity/platform-admin-security-event.entity';
import { PlatformSettingsService } from './platform-settings.service';
import { PlatformSettingKey } from '../enum/platform-setting-key.enum';
import { FREE_PLAN_IDS } from '../../billing/util/free-plan.util';

// Console delete for a church that went live: suspended first, small, free and outside any network, so real churches can't be wiped by mistake.
@Injectable()
export class ChurchDeletionService {
  private readonly logger = new Logger(ChurchDeletionService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(PlatformAdminSecurityEvent)
    private readonly securityEventRepo: Repository<PlatformAdminSecurityEvent>,
    private readonly tenantDeletion: TenantDeletionService,
    private readonly platformSettings: PlatformSettingsService,
  ) {}

  async delete(tenant: Tenant, actorId: string): Promise<void> {
    const refusal = await this.refusal(tenant);
    if (refusal) throw new ConflictException(refusal);
    const links: { account_id: string }[] = await this.dataSource.query(
      `SELECT account_id FROM public.discuva_account_links WHERE tenant_id = $1`,
      [tenant.id],
    );
    await this.tenantDeletion.delete(tenant);
    await this.removeAccountsLeftWithNoChurch(links.map((l) => l.account_id));
    this.logger.warn(
      `Church "${tenant.subdomain}" (${tenant.id}) deleted by platform admin ${actorId}`,
    );
    await this.securityEventRepo.insert({
      platformAdminId: actorId,
      actorId,
      action: `deleted church ${tenant.subdomain}`,
    });
  }

  private async refusal(tenant: Tenant): Promise<string | null> {
    if (tenant.isActive) return 'Suspend this church before deleting it.';
    if (!isSafeSchema(tenant.schemaName))
      return 'This church cannot be deleted here.';
    const max = await this.platformSettings.getNumber(
      PlatformSettingKey.CHURCH_DELETE_MAX_MEMBERS,
    );
    const [row] = await this.dataSource.query(
      `SELECT
         (SELECT count(*)::int FROM "${tenant.schemaName}".members) AS members,
         ($2::uuid IS NOT NULL OR EXISTS (SELECT 1 FROM public.tenants c WHERE c.parent_tenant_id = $1)) AS network,
         EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.tenant_id = $1 AND s.plan_id <> ALL($3)) AS paid`,
      [tenant.id, tenant.parentTenantId ?? null, FREE_PLAN_IDS],
    );
    if (row.network)
      return 'This church is part of a network and cannot be deleted here.';
    if (row.paid)
      return 'This church is on a paid plan and cannot be deleted here.';
    if (row.members > max) {
      return `This church has ${row.members} members; the console only deletes churches with up to ${max}.`;
    }
    return null;
  }

  // Someone who is also at another church keeps their account.
  private async removeAccountsLeftWithNoChurch(ids: string[]): Promise<void> {
    if (!ids.length) return;
    await this.dataSource.query(
      `DELETE FROM public.discuva_accounts a WHERE a.id = ANY($1)
         AND NOT EXISTS (SELECT 1 FROM public.discuva_account_links l WHERE l.account_id = a.id)`,
      [ids],
    );
  }
}
