import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'network_moves' })
export class NetworkMove {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'network_root_id' })
  networkRootId: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'uuid', name: 'from_parent_id', nullable: true })
  fromParentId: string | null;

  @Column({ type: 'uuid', name: 'to_parent_id', nullable: true })
  toParentId: string | null;

  @Column({ type: 'uuid', name: 'moved_by_tenant_id', nullable: true })
  movedByTenantId: string | null;

  @Column({ type: 'uuid', name: 'moved_by_member_id', nullable: true })
  movedByMemberId: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
