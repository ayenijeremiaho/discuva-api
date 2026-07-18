import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { MemberImportJobStatus } from '../enums/member-import-job-status.enum';
import { Admin } from '../../admin/entity/admin.entity';

@Entity({ name: 'member_import_jobs' })
export class MemberImportJob extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  originalFilename: string;

  @Column({ type: 'varchar', default: MemberImportJobStatus.READY_FOR_REVIEW })
  status: MemberImportJobStatus;

  @Column({ type: 'int', default: 0 })
  totalRows: number;

  @Column({ type: 'int', default: 0 })
  validRows: number;

  @Column({ type: 'int', default: 0 })
  createdCount: number;

  @Column({ type: 'int', default: 0 })
  failedCommitCount: number;

  @ManyToOne(() => Admin, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'created_by_id' })
  createdBy: Admin;
}
