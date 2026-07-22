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
import { PregnancyCaseStatusEnum } from '../enum/pregnancy-case-status.enum';

@Entity({ name: 'pregnancy_prayer_cases' })
export class PregnancyPrayerCase extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Nullable — she may not be an existing Member. Name is snapshotted below
  // for the same reason PrayerRequest snapshots submittedByName.
  @Index()
  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'member_id' })
  member: Member | null;

  @Column()
  name: string;

  @Column({ type: 'date' })
  edd: string;

  @Column({ type: 'text', nullable: true })
  details: string | null;

  @Index()
  @Column({
    type: 'character varying',
    default: PregnancyCaseStatusEnum.ACTIVE,
  })
  status: PregnancyCaseStatusEnum;

  @Column({ name: 'last_prayed_at', type: 'timestamptz', nullable: true })
  lastPrayedAt: Date | null;

  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by' })
  createdBy: Member | null;

  @Column({ name: 'created_by_name' })
  createdByName: string;
}
