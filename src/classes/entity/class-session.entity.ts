import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { ChurchClass } from './church-class.entity';
import { ClassSessionModeEnum } from '../enum/class-session-mode.enum';

// One scheduled day of a training class (a class runs over several months).
@Entity('class_sessions')
@Index(['churchClass', 'startsAt'])
export class ClassSession extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => ChurchClass, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'church_class_id' })
  churchClass: ChurchClass;

  @Column({ type: 'varchar', nullable: true })
  title: string | null;

  @Column({ type: 'timestamptz' })
  startsAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  endsAt: Date | null;

  @Column({ type: 'varchar', default: ClassSessionModeEnum.PHYSICAL })
  mode: ClassSessionModeEnum;

  @Column({ type: 'varchar', nullable: true })
  location: string | null;

  @Column({ type: 'varchar', nullable: true })
  meetingLink: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;
}
