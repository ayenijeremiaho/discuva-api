import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

// A branch's venue code: typed in the app, or opened from the QR poster, when location can't place someone.
@Entity({ name: 'network_visit_codes' })
export class NetworkVisitCode {
  @PrimaryColumn({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'varchar', length: 8, unique: true })
  code: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
