import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { WorkerProfile } from '../../member/entity/worker-profile.entity';
import { BaseEntity } from '../../utility/entity/base.entity';
import { DepartmentCapability } from '../enums/department-capability.enum';

@Entity({ name: 'departments' })
export class Department extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  name: string;

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
