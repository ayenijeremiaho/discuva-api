import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { Member } from '../../member/entity/member.entity';

// Points per member per month (church timezone), kept up to date as points are awarded.
@Entity({ name: 'bible_game_monthly' })
@Index('IDX_bible_game_monthly_board', ['month', 'points'])
export class BibleGameMonthly extends BaseEntity {
  @PrimaryColumn({ name: 'member_id', type: 'uuid' })
  memberId: string;

  @ManyToOne(() => Member, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'member_id' })
  member?: Member;

  @PrimaryColumn({ type: 'date' })
  month: string;

  @Column({ type: 'int', default: 0 })
  points: number;
}
