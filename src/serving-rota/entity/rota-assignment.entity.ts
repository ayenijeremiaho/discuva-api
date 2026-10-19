import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { Department } from '../../department/entity/department.entity';
import { ServiceSlot } from '../../event/entity/service-slot.entity';
import { Member } from '../../member/entity/member.entity';

// One person serving with one department at one service, optionally in a named role.
@Entity({ name: 'rota_assignments' })
@Unique(['serviceSlot', 'department', 'member'])
@Index(['department', 'serviceSlot'])
export class RotaAssignment extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Department, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'department_id' })
  department: Department;

  @ManyToOne(() => ServiceSlot, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'service_slot_id' })
  serviceSlot: ServiceSlot;

  @Index()
  @ManyToOne(() => Member, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'member_id' })
  member: Member;

  @Column({ type: 'varchar', length: 80, nullable: true })
  role: string | null;

  @Index()
  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'assigned_by_id' })
  assignedBy: Member | null;
}
