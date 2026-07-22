import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Member } from '../../member/entity/member.entity';
import { BaseEntity } from '../../utility/entity/base.entity';
import { PregnancyPrayerCase } from './pregnancy-prayer-case.entity';

@Entity({ name: 'pregnancy_prayer_visits' })
export class PregnancyPrayerVisit extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @ManyToOne(() => PregnancyPrayerCase, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'case_id' })
  case: PregnancyPrayerCase;

  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'logged_by' })
  loggedBy: Member | null;

  @Column({ name: 'logged_by_name' })
  loggedByName: string;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({
    name: 'visited_at',
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
  })
  visitedAt: Date;
}
