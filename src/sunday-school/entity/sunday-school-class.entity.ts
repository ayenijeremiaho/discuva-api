import {
  Column,
  Entity,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Member } from '../../member/entity/member.entity';
import { BaseEntity } from '../../utility/entity/base.entity';
import { MeetingDayEnum } from '../enums/meeting-day.enum';

@Entity('sunday_school_classes')
export class SundaySchoolClass extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ nullable: true, type: 'text' })
  description: string | null;

  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'teacher_id' })
  teacher: Member | null;

  // Same rights as the teacher for this class (attendance, members, sessions).
  @ManyToMany(() => Member)
  @JoinTable({
    name: 'sunday_school_class_assistants',
    joinColumn: { name: 'sunday_school_class_id' },
    inverseJoinColumn: { name: 'member_id' },
  })
  assistants?: Member[];

  @Column({ type: 'varchar', nullable: true })
  ageGroup: string | null;

  @Column({ type: 'varchar', nullable: true })
  meetingDay: MeetingDayEnum | null;

  // "HH:mm", church local time.
  @Column({ type: 'varchar', nullable: true })
  meetingTime: string | null;

  @Column({ type: 'varchar', nullable: true })
  location: string | null;
}
