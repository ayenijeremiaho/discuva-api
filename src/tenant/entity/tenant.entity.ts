import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';

// Control-plane table — lives in `public`, never a `search_path` target.
// See docs/MULTI_TENANT_MIGRATION.md §4.1.
@Entity({ name: 'tenants' })
export class Tenant extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column()
  subdomain: string;

  @Index({ unique: true })
  @Column()
  schemaName: string;

  @Column({ default: 'default' })
  clusterId: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  logoUrl: string | null;

  @Column({ default: 'NGN' })
  currency: string;

  @Column({ default: 'UTC' })
  timezone: string;

  @Column({ default: true })
  isActive: boolean;
}
