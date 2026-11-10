import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import type { ClassMilestoneType } from '../../discuva-account/enum/milestone.enum';

@Entity({ name: 'class_types' })
export class ClassType extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  name: string;

  @Column({ nullable: true, type: 'text' })
  description: string | null;

  @Index()
  @Column({ default: true })
  isActive: boolean;

  // Completing a class of this type adds this milestone to the person's Discuva profile.
  @Column({ type: 'varchar', length: 24, nullable: true })
  countsAs: ClassMilestoneType | null;

  @ManyToOne(() => ClassType, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'next_class_type_id' })
  nextClassType: ClassType | null;
}
