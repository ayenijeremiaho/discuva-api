import { EventAudienceEnum } from '../enums/event-audience.enum';
import { Group } from '../../group/entity/group.entity';
import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { EventRecurrencePatternEnum } from '../enums/event-recurrence-patterns.enums';
import type { SlotBlueprint } from '../types/slot-blueprint';

export interface TemplateRecurrence {
  recurrencePattern: EventRecurrencePatternEnum;
  recurrenceInterval: number;
  ongoing: boolean;
  weekday?: number;
}

// A saved service type ("Sunday Service", "Midweek Bible Study") to start new events from.
@Entity({ name: 'event_templates' })
export class EventTemplate extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ type: 'varchar', nullable: true })
  description: string | null;

  @Column({ name: 'online_attendance_enabled', default: false })
  onlineAttendanceEnabled: boolean;

  @Column({ name: 'slot_blueprint', type: 'jsonb', default: () => "'[]'" })
  slotBlueprint: SlotBlueprint[];

  @Column({ name: 'default_recurrence', type: 'jsonb', nullable: true })
  defaultRecurrence: TemplateRecurrence | null;

  @Column({ type: 'varchar', default: EventAudienceEnum.EVERYONE })
  audience: EventAudienceEnum;

  // GROUP only; if the group is deleted the event falls back to everyone.
  @Column({ name: 'audience_group_id', type: 'uuid', nullable: true })
  audienceGroupId: string | null;

  @ManyToOne(() => Group, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'audience_group_id' })
  audienceGroup?: Group | null;

  @Column({ name: 'auto_programme', default: true })
  autoProgramme: boolean;
}
