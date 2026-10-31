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
import { Member } from '../../member/entity/member.entity';
import { RotaSubteam } from './rota-subteam.entity';

@Entity({ name: 'rota_planner_grants' })
@Unique(['department', 'member', 'subteam'])
@Index(['member', 'department'])
export class RotaPlannerGrant extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Department, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'department_id' })
  department: Department;

  @ManyToOne(() => Member, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'member_id' })
  member: Member;

  @ManyToOne(() => RotaSubteam, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subteam_id' })
  subteam: RotaSubteam | null;

  @Column({ name: 'can_publish', default: false })
  canPublish: boolean;
}
