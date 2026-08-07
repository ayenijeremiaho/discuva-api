import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { Tenant } from './tenant.entity';

// Control-plane table — lives in `public`, alongside `tenants` itself, not
// a per-tenant schema. This is the same category of data as
// tenant.logoUrl (self-service branding a church sets once and rarely
// touches), not operational/business data that needs schema isolation.
@Entity({ name: 'tenant_asset_overrides' })
@Index(['tenant', 'assetKey'], { unique: true })
export class TenantAssetOverride extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  // One of KNOWN_ASSETS' keys (src/tenant/constants/known-assets.constant.ts)
  // — validated against that list in the service, not enforced at the DB
  // level, so the catalog can grow without a migration.
  @Column()
  assetKey: string;

  @Column()
  imageUrl: string;

  // Cloudinary asset id backing imageUrl — needed to delete the previous
  // asset when replaced. Never exposed via the API, mirrors
  // Tenant.logoPublicId's exact treatment.
  @Column()
  imagePublicId: string;
}
