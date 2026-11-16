import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Member } from '../../member/entity/member.entity';
import { ChildAgeGroup } from './child-age-group.entity';
import { ChildClassGroup } from './child-class-group.entity';
import { ChildGuardian } from './child-guardian.entity';
import { BaseEntity } from '../../utility/entity/base.entity';

@Entity('child_profiles')
export class ChildProfile extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  firstname: string;

  @Index()
  @Column()
  lastname: string;

  @Column({ type: 'date', nullable: true })
  dateOfBirth: string | null;

  @Column({ type: 'varchar', nullable: true })
  ageRange: string | null;

  @Column({ type: 'date', nullable: true })
  ageRangeSetOn: string | null;

  @Column({ nullable: true })
  photoUrl: string | null;

  @Column({ nullable: true, type: 'text' })
  specialNotes: string | null;

  @Index()
  @ManyToOne(() => ChildAgeGroup, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'age_group_id' })
  ageGroup: ChildAgeGroup | null;

  @Index()
  @ManyToOne(() => ChildClassGroup, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'class_group_id' })
  classGroup: ChildClassGroup | null;

  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'registered_by_id' })
  registeredBy: Member | null;

  @Column({ type: 'varchar', nullable: true })
  emergencyContactName: string | null;

  @Column({ type: 'varchar', nullable: true })
  emergencyContactRelationship: string | null;

  @Column({ type: 'varchar', nullable: true })
  emergencyContactPhone: string | null;

  @Column({ type: 'varchar', nullable: true })
  doctorName: string | null;

  @Column({ type: 'varchar', nullable: true })
  doctorPhone: string | null;

  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'notes_updated_by_id' })
  notesUpdatedBy: Member | null;

  @Column({ type: 'timestamptz', nullable: true })
  notesUpdatedAt: Date | null;

  // Away message counts only on awayDate (church-local day), so it clears itself.
  @Column({ type: 'date', nullable: true })
  awayDate: string | null;

  @ManyToOne(() => ChildGuardian, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'away_collector_id' })
  awayCollector: ChildGuardian | null;

  @Column({ type: 'text', nullable: true })
  awayMessage: string | null;

  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'away_set_by_id' })
  awaySetBy: Member | null;

  @OneToMany(() => ChildGuardian, (guardian) => guardian.child)
  guardians: ChildGuardian[];

  // Transient — populated explicitly by ChildrenChurchService.getChild(),
  // not persisted. Total Children's Church check-ins for this child.
  visitCount?: number;
}
