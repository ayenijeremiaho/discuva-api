import { Column, Entity, PrimaryColumn } from 'typeorm';

// Control-plane table — lives in `public`, never a `search_path` target.
// Platform-wide registry of the subscription-billing vendors
// PaymentProviderRegistryService registers ('paystack', 'flutterwave',
// 'kora') — mirrors GivingProvider/CommunicationProvider's shape exactly.
// Unlike those two, there's no per-tenant BYOK config table: every tenant
// shares the platform's own provider credentials for subscription billing,
// so this row's isActive is the only thing PaymentProviderRegistryService
// checks (see its assertActive()).
@Entity({ name: 'payment_providers' })
export class PlatformPaymentProvider {
  @PrimaryColumn()
  id: string;

  @Column()
  name: string;

  @Column({ default: true })
  isActive: boolean;
}
