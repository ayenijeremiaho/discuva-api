import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';

// Control-plane table — lives in `public`, same as Plan/Subscription (a
// tenant schema table would need TenantTypeOrmModule and CLS transaction
// plumbing PlanGuard doesn't otherwise need). One row per (tenantId,
// feature) pair — lifetime count, never reset automatically. A platform
// admin changing a tenant's plan doesn't clear this: upgrading past a cap
// and later downgrading back below it should still reflect prior usage,
// not grant a fresh allowance.
@Entity({ name: 'feature_usages' })
@Index(['tenantId', 'feature'], { unique: true })
export class FeatureUsage extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  tenantId: string;

  @Column()
  feature: string;

  @Column({ type: 'int', default: 0 })
  count: number;
}
