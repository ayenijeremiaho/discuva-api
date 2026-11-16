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
import { ChildCheckIn } from './child-check-in.entity';
import { ChildNoteKind } from '../enums/child-note-kind.enum';

@Entity('child_checkin_notes')
@Index(['checkIn', 'createdAt'])
export class ChildCheckInNote extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => ChildCheckIn, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'check_in_id' })
  checkIn: ChildCheckIn;

  @Index()
  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'author_id' })
  author: Member | null;

  @Column({ default: false })
  fromParent: boolean;

  @Column({ type: 'varchar', default: ChildNoteKind.FEEDBACK })
  kind: ChildNoteKind;

  @Column({ type: 'text' })
  text: string;

  @Column({ default: false })
  sharedWithParents: boolean;

  @Index()
  @ManyToOne(() => ChildCheckInNote, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'reply_to_id' })
  replyTo: ChildCheckInNote | null;

  @Column({ type: 'timestamptz', nullable: true })
  parentSeenAt: Date | null;

  @Index()
  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'parent_seen_by_id' })
  parentSeenBy: Member | null;
}
