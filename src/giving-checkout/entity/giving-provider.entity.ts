import { Column, Entity, PrimaryColumn } from 'typeorm';

// Control-plane table — lives in `public`, never a `search_path` target.
// Platform-wide registry of available giving-checkout vendors — 'paystack',
// 'flutterwave', 'kora', 'stripe'. Mirrors CommunicationProvider's shape
// exactly; per-tenant BYOK credentials live separately in
// TenantGivingProviderConfig.
@Entity({ name: 'giving_providers' })
export class GivingProvider {
  @PrimaryColumn()
  id: string;

  @Column()
  name: string;

  @Column({ default: true })
  isActive: boolean;
}
