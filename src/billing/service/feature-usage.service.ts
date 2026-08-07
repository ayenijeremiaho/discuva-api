import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class FeatureUsageService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  // Atomically increments (tenantId, feature)'s lifetime count only if it's
  // still under `limit` — single conditional upsert so two concurrent
  // requests can't both read "one use left" and both proceed. Returns
  // whether this call consumed a use; false means the cap was already hit
  // (or limit isn't positive) and PlanGuard should reject the request.
  async tryConsume(
    tenantId: string,
    feature: string,
    limit: number,
  ): Promise<boolean> {
    if (limit <= 0) return false;

    const rows = await this.dataSource.query(
      `INSERT INTO feature_usages (id, tenant_id, feature, count, created_at, updated_at)
       VALUES ($1, $2, $3, 1, now(), now())
       ON CONFLICT (tenant_id, feature)
       DO UPDATE SET count = feature_usages.count + 1, updated_at = now()
       WHERE feature_usages.count < $4
       RETURNING count`,
      [randomUUID(), tenantId, feature, limit],
    );
    return rows.length > 0;
  }

  async getUsage(tenantId: string, feature: string): Promise<number> {
    const rows = await this.dataSource.query(
      `SELECT count FROM feature_usages WHERE tenant_id = $1 AND feature = $2`,
      [tenantId, feature],
    );
    return rows[0]?.count ?? 0;
  }
}
