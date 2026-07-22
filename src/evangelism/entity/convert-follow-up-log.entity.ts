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
import { Convert } from './convert.entity';

@Entity({ name: 'convert_follow_up_logs' })
export class ConvertFollowUpLog extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @ManyToOne(() => Convert, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'convert_id' })
  convert: Convert;

  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'logged_by' })
  loggedBy: Member | null;

  @Column({ name: 'logged_by_name' })
  loggedByName: string;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({
    name: 'contacted_at',
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
  })
  contactedAt: Date;
}
