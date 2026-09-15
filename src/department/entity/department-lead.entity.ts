import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { WorkerProfile } from '../../member/entity/worker-profile.entity';
import { Department } from './department.entity';
import { DepartmentLeadTypeEnum } from '../enums/department-lead-type.enum';
import { BaseEntity } from '../../utility/entity/base.entity';

@Entity({ name: 'department_leads' })
@Unique(['department', 'leadType'])
// A worker can hold at most one lead role PER department — this is what
// stops the same person being assigned as both HOD and Deputy HOD of the
// same department. DepartmentService.assignLead already checks this at the
// service layer (with a clear error message); this is the DB-level backup
// for any write path that doesn't go through it. Deliberately NOT
// UNIQUE(worker_profile_id) alone — that was the earlier bug, blocking a
// worker from leading more than one department entirely.
@Unique(['department', 'workerProfile'])
export class DepartmentLead extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ManyToOne, not OneToOne — a worker can lead more than one department
  // (DepartmentService.resolveLeadDepartmentId/getLeadRoles already
  // document this as the intended, expected case). A prior OneToOne here
  // matched a leftover DB-level UNIQUE(worker_profile_id) constraint from
  // the original schema that made a worker leadable in at most ONE
  // department total, across every department and lead type — see the
  // migration dropping that constraint.
  @Index()
  @ManyToOne(() => WorkerProfile)
  @JoinColumn({ name: 'worker_profile_id' })
  workerProfile: WorkerProfile;

  @ManyToOne(() => Department, (department) => department.id)
  @JoinColumn({ name: 'department_id' })
  department: Department;

  @Column()
  leadType: DepartmentLeadTypeEnum;
}
