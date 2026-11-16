import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ChildAgeGroup } from './child-age-group.entity';
import { BaseEntity } from '../../utility/entity/base.entity';

@Entity('child_class_groups')
export class ChildClassGroup extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @ManyToOne(() => ChildAgeGroup, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'age_group_id' })
  ageGroup: ChildAgeGroup;

  @Column()
  name: string;

  @Column({ type: 'int', nullable: true })
  capacity: number | null;

  @Column({ type: 'int', nullable: true })
  childrenPerTeacher: number | null;

  @Column({ nullable: true, type: 'text' })
  teacherNote: string | null;
}
