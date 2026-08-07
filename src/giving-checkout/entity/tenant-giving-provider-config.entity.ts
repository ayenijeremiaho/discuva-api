import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';

// Control-plane table — lives in `public`, never a `search_path` target.
// One row per (tenant, provider) — a tenant's own Paystack/Flutterwave/
// Kora/Stripe credentials for receiving tithes/offerings directly, same
// shape as TenantCommunicationProviderConfig. Must be resolvable from a
// tenantId alone with no tenant (schema) context established yet — the
// inbound provider webhook that reads this has no Host header/subdomain to
// resolve a tenant from at all, only the :tenantId path param.
@Entity({ name: 'tenant_giving_provider_configs' })
export class TenantGivingProviderConfig extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  tenantId: string;

  @Column()
  providerId: string;

  @Column({ type: 'jsonb', select: false })
  credentialsEncrypted: Record<string, unknown>;

  @Column({ default: true })
  isActive: boolean;
}
