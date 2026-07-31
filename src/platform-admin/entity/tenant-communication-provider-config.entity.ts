import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';

// Control-plane table — lives in `public`, never a `search_path` target.
// One row per (tenant, provider) — a tenant's BYOK credentials for one
// SMS/email provider (§4.12). credentialsEncrypted must never be returned
// to a client verbatim — see docs/MULTI_TENANT_MIGRATION.md §13.
@Entity({ name: 'tenant_communication_provider_configs' })
export class TenantCommunicationProviderConfig extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  tenantId: string;

  @Column()
  providerId: string;

  @Column({ type: 'jsonb', select: false })
  credentialsEncrypted: Record<string, unknown>;

  @Column({ nullable: true })
  senderIdentity: string | null;

  @Column({ default: true })
  isActive: boolean;
}
