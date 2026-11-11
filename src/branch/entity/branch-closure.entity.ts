import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum BranchClosureStatus {
  SCHEDULED = 'SCHEDULED',
  RUNNING = 'RUNNING',
  DONE = 'DONE',
  CANCELLED = 'CANCELLED',
  FAILED = 'FAILED',
}

export interface ClosureSummary {
  moved: number;
  copied: number;
  alreadyThere: number;
  stayedInactive: number;
  firstTimers: number;
  eventsCancelled: number;
  seriesStopped: number;
  failed: number;
}

// A branch closing on a set date: its members move to the destination, then it's kept read-only.
@Entity({ name: 'branch_closures' })
export class BranchClosure {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'uuid', name: 'network_root_id' })
  networkRootId: string;

  @Column({ type: 'uuid', name: 'destination_tenant_id' })
  destinationTenantId: string;

  // The church's own local date it closes on.
  @Column({ type: 'date', name: 'closes_on' })
  closesOn: string;

  @Column({ type: 'timestamptz', name: 'run_at' })
  runAt: Date;

  @Column({ type: 'varchar' })
  status: BranchClosureStatus;

  @Column({ type: 'uuid', name: 'requested_by_tenant_id' })
  requestedByTenantId: string;

  @Column({ type: 'uuid', name: 'requested_by_member_id', nullable: true })
  requestedByMemberId: string | null;

  @Column({ type: 'jsonb', nullable: true })
  summary: ClosureSummary | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @Column({ type: 'timestamptz', name: 'finished_at', nullable: true })
  finishedAt: Date | null;
}
