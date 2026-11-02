import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Campus } from '../../campus/campus.entity';
import { WorkerProfile } from '../../member/entity/worker-profile.entity';
import { BaseEntity } from '../../utility/entity/base.entity';
import { DepartmentCapability } from '../enums/department-capability.enum';

// Unique per campus: UQ_departments_name_campus is an expression index (name, COALESCE(campus_id, nil uuid)).
@Entity({ name: 'departments' })
export class Department extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  // Null: church-wide.
  @Index('IDX_departments_campus_id')
  @Column({ type: 'uuid', name: 'campus_id', nullable: true })
  campusId: string | null;

  @ManyToOne(() => Campus, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'campus_id' })
  campus: Campus | null;

  @Column()
  description: string;

  /**
   * Fixed, code-defined feature flags this department grants to its workers
   * (both primary and secondary) — e.g. CHILDREN_CHURCH unlocks the Children's
   * Church worker tools in the mobile app and the corresponding backend write
   * endpoints. Multiple departments can share a capability, and a single
   * department can hold more than one (unlike the old single-value `key`
   * column it replaces). Only values with a real feature behind them belong
   * in DepartmentCapability — see department-capability.enum.ts.
   */
  @Column({ type: 'text', array: true, default: '{}' })
  capabilities: DepartmentCapability[];

  @OneToMany(() => WorkerProfile, (profile) => profile.department)
  workerProfiles: WorkerProfile[];
}
