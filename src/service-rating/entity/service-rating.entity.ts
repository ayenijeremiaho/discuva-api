import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { Event } from '../../event/entity/event.entity';
import { ServiceSlot } from '../../event/entity/service-slot.entity';
import { Member } from '../../member/entity/member.entity';

@Entity({ name: 'service_ratings' })
@Unique(['event', 'serviceSlot', 'member'])
export class ServiceRating extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @ManyToOne(() => Event, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'event_id' })
  event: Event;

  @ManyToOne(() => ServiceSlot, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'service_slot_id' })
  serviceSlot: ServiceSlot;

  @ManyToOne(() => Member, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'member_id' })
  member: Member;

  @Column({ type: 'smallint' })
  rating: number;

  @Column({ type: 'text', nullable: true })
  comment: string | null;
}
