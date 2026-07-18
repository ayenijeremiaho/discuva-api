import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { MemberImportJob } from './member-import-job.entity';
import { MemberImportRowStatus } from '../enums/member-import-row-status.enum';
import { MemberImportRowData } from '../interface/member-import-row-data.interface';

@Entity({ name: 'member_import_rows' })
export class MemberImportRow extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @ManyToOne(() => MemberImportJob, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'job_id' })
  job: MemberImportJob;

  @Column({ type: 'int' })
  rowNumber: number;

  @Column({ type: 'jsonb' })
  data: MemberImportRowData;

  // Validation errors found at preview time — empty array means the row is
  // eligible to be committed.
  @Column({ type: 'jsonb', default: () => "'[]'" })
  errors: string[];

  @Column({ type: 'varchar', default: MemberImportRowStatus.PENDING })
  status: MemberImportRowStatus;

  @Column({ type: 'uuid', nullable: true })
  createdMemberId: string | null;

  // Set only if the row passed preview validation but still failed at
  // commit time (e.g. a race on email uniqueness).
  @Column({ type: 'varchar', nullable: true })
  commitError: string | null;
}
