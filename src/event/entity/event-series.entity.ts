import { Campus } from '../../campus/campus.entity';
import { EventAudienceEnum } from '../enums/event-audience.enum';
import { Group } from '../../group/entity/group.entity';
import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Index,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { Member } from '../../member/entity/member.entity';
import { EventRecurrencePatternEnum } from '../enums/event-recurrence-patterns.enums';
import type { SlotBlueprint } from '../types/slot-blueprint';

// The repeat rule behind a recurring event; its id is the occurrences' recurringEventId.
@Entity({ name: 'event_series' })
export class EventSeries extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ type: 'varchar', nullable: true })
  description: string | null;

  @Column({ name: 'online_attendance_enabled', default: false })
  onlineAttendanceEnabled: boolean;

  @Column({ name: 'recurrence_pattern', type: 'varchar' })
  recurrencePattern: EventRecurrencePatternEnum;

  @Column({ name: 'recurrence_interval', type: 'int', default: 1 })
  recurrenceInterval: number;

  @Column({ name: 'start_date', type: 'date' })
  startDate: string;

  // Null = ongoing.
  @Column({ name: 'end_date', type: 'date', nullable: true })
  endDate: string | null;

  @Column({ name: 'slot_blueprint', type: 'jsonb', default: () => "'[]'" })
  slotBlueprint: SlotBlueprint[];

  @Column({ name: 'auto_programme', default: true })
  autoProgramme: boolean;

  // Last occurrence date already created; never generated again, so a cancelled one stays cancelled.
  @Column({ name: 'generated_through', type: 'date', nullable: true })
  generatedThrough: string | null;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ type: 'varchar', default: EventAudienceEnum.EVERYONE })
  audience: EventAudienceEnum;

  // GROUP only; if the group is deleted the event falls back to everyone.
  @Column({ name: 'audience_group_id', type: 'uuid', nullable: true })
  audienceGroupId: string | null;

  @ManyToOne(() => Group, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'audience_group_id' })
  audienceGroup?: Group | null;

  // Null: the whole church. Otherwise shown to and reminding only that campus; anyone may still check in.
  @Index('IDX_event_series_campus_id')
  @Column({ type: 'uuid', name: 'campus_id', nullable: true })
  campusId: string | null;

  @ManyToOne(() => Campus, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'campus_id' })
  campus?: Campus | null;

  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by' })
  createdBy: Member | null;
}
