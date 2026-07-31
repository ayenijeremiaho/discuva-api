import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

// Control-plane table — lives in `public`, never a `search_path` target.
// Price and tier count are data, not code: `id` is free-form and `features`
// is an array, so adding a third tier is a row insert (docs/MULTI_TENANT_MIGRATION.md §4.11).
@Entity({ name: 'plans' })
export class Plan {
  @PrimaryColumn()
  id: string;

  @Column()
  name: string;

  @Column({ default: 0 })
  priceCents: number;

  @Column({ default: 'NGN' })
  currency: string;

  @Column({ nullable: true })
  billingProviderPriceId: string | null;

  @Column('text', { array: true, default: '{}' })
  features: string[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
