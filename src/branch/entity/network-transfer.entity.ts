import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

export enum NetworkTransferStatus {
  PENDING = 'PENDING',
  DONE = 'DONE',
  DECLINED = 'DECLINED',
  CANCELLED = 'CANCELLED',
}

// A move between branches of one network. Member ids are plain: each lives in its own branch's schema.
@Entity({ name: 'network_transfers' })
export class NetworkTransfer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'network_root_id' })
  networkRootId: string;

  @Column({ type: 'uuid', name: 'account_id' })
  accountId: string;

  @Column({ type: 'uuid', name: 'from_tenant_id' })
  fromTenantId: string;

  @Column({ type: 'uuid', name: 'to_tenant_id' })
  toTenantId: string;

  @Column({ type: 'uuid', name: 'from_member_id' })
  fromMemberId: string;

  @Column({ type: 'uuid', name: 'to_member_id', nullable: true })
  toMemberId: string | null;

  @Column({ type: 'varchar' })
  status: NetworkTransferStatus;

  @Column({ name: 'needs_release', default: false })
  needsRelease: boolean;

  @Column({ type: 'timestamptz', name: 'requested_at', default: () => 'now()' })
  requestedAt: Date;

  @Column({ type: 'timestamptz', name: 'decided_at', nullable: true })
  decidedAt: Date | null;

  @Column({ type: 'uuid', name: 'decided_by_member_id', nullable: true })
  decidedByMemberId: string | null;

  @Column({
    type: 'varchar',
    length: 300,
    name: 'decline_reason',
    nullable: true,
  })
  declineReason: string | null;
}
