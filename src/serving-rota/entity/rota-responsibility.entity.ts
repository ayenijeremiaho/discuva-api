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
import { RotaSubteam } from './rota-subteam.entity';
import { RotaAllocationMode } from '../enum/rota-allocation-mode.enum';

@Entity({ name: 'rota_responsibilities' })
@Unique(['department', 'name'])
@Index(['department', 'subteam', 'position'])
export class RotaResponsibility extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Department, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'department_id' })
  department: Department;

  @ManyToOne(() => RotaSubteam, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'subteam_id' })
  subteam: RotaSubteam | null;

  @Column({ type: 'varchar', length: 80 })
  name: string;

  @Column({ name: 'required_count', type: 'smallint', default: 1 })
  requiredCount: number;

  @Column({
    name: 'allocation_mode',
    type: 'varchar',
    length: 16,
    default: RotaAllocationMode.MANUAL,
  })
  allocationMode: RotaAllocationMode;

  @Column({ type: 'integer', default: 0 })
  position: number;
}
