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
import {
  RotaAllocationMode,
  RotaScheduleType,
} from '../enum/rota-allocation-mode.enum';

@Entity({ name: 'rota_schedules' })
@Unique(['department', 'name'])
@Index(['department', 'active', 'position'])
export class RotaSchedule extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Department, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'department_id' })
  department: Department;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ name: 'schedule_type', type: 'varchar', length: 20 })
  scheduleType: RotaScheduleType;

  @Column({
    name: 'allocation_mode',
    type: 'varchar',
    length: 16,
    default: RotaAllocationMode.MANUAL,
  })
  allocationMode: RotaAllocationMode;

  @Column({ name: 'day_of_week', type: 'smallint', nullable: true })
  dayOfWeek: number | null;

  @Column({ name: 'start_time', type: 'time', nullable: true })
  startTime: string | null;

  @Column({ name: 'end_time', type: 'time', nullable: true })
  endTime: string | null;

  @Column({ default: true })
  active: boolean;

  @Column({ type: 'integer', default: 0 })
  position: number;
}
