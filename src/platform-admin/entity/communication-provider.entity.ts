import { Column, Entity, PrimaryColumn } from 'typeorm';

// Control-plane table — lives in `public`, never a `search_path` target.
// Platform-wide registry of available SMS/email providers (§4.12) — e.g.
// 'termii', 'gmail', 'resend'. Per-tenant credentials live separately in
// TenantCommunicationProviderConfig.
@Entity({ name: 'communication_providers' })
export class CommunicationProvider {
  @PrimaryColumn()
  id: string;

  @Column()
  channel: string;

  @Column()
  name: string;

  @Column({ default: true })
  isActive: boolean;
}
