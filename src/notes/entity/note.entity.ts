import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { Member } from '../../member/entity/member.entity';
import { Sermon } from '../../sermon/entity/sermon.entity';
import { Event } from '../../event/entity/event.entity';
import { ServiceSlot } from '../../event/entity/service-slot.entity';
import { NoteKindEnum } from '../enum/note-kind.enum';
import type { NoteNode } from '../util/note-content';

// Private to the member who wrote it — no admin route ever returns content.
@Entity({ name: 'notes' })
@Index('IDX_notes_member_updated', ['memberId', 'updatedAt'])
@Index('UQ_notes_member_service_slot', ['memberId', 'serviceSlotId'], {
  unique: true,
  where: 'service_slot_id IS NOT NULL',
})
export class Note extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Member, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'member_id' })
  member?: Member;

  @Column({ name: 'member_id', type: 'uuid' })
  memberId: string;

  @Column({ type: 'varchar', default: NoteKindEnum.PERSONAL })
  kind: NoteKindEnum;

  @Column({ type: 'varchar', length: 200, default: '' })
  title: string;

  @Column({ type: 'jsonb' })
  content: NoteNode;

  @Column({ name: 'plain_text', type: 'text', default: '' })
  plainText: string;

  // Canonical refs ("JHN.3.16") pulled from the content, for "most noted" counts.
  @Column({ name: 'scripture_refs', type: 'jsonb', default: () => "'[]'" })
  scriptureRefs: string[];

  // Excludes template headings, so an untouched guided note counts as empty for streaks and reminders.
  @Column({ name: 'word_count', type: 'int', default: 0 })
  wordCount: number;

  // The member's "One thing I'll do this week", for the Monday reminder.
  @Column({ type: 'varchar', length: 200, nullable: true })
  commitment: string | null;

  @ManyToOne(() => Sermon, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'sermon_id' })
  sermon?: Sermon | null;

  @Index('IDX_notes_sermon_id')
  @Column({ name: 'sermon_id', type: 'uuid', nullable: true })
  sermonId: string | null;

  @ManyToOne(() => Event, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'event_id' })
  event?: Event | null;

  @Index('IDX_notes_event_id')
  @Column({ name: 'event_id', type: 'uuid', nullable: true })
  eventId: string | null;

  @ManyToOne(() => ServiceSlot, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'service_slot_id' })
  serviceSlot?: ServiceSlot | null;

  @Column({ name: 'service_slot_id', type: 'uuid', nullable: true })
  serviceSlotId: string | null;

  @Column({ default: false })
  pinned: boolean;
}
