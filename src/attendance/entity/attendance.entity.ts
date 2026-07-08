import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { AttendanceStatusEnum } from '../enums/check-in.enum';
import { Member } from '../../member/entity/member.entity';
import { ServiceSlot } from '../../event/entity/service-slot.entity';
import { Event } from '../../event/entity/event.entity';
import { MemberRoleEnum } from '../../member/enums/member-role.enum';
import { BaseEntity } from '../../utility/entity/base.entity';

interface LocationData {
  longitude: number;
  latitude: number;
}

@Entity({ name: 'attendances' })
@Unique(['member', 'event'])
@Index(['member', 'roleAtCheckin', 'createdAt'])
export class Attendance extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @ManyToOne(() => Member, (member) => member.attendances, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'member_id' })
  member: Member;

  @Index()
  @ManyToOne(() => Event, (event) => event.attendances, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'event_id' })
  event: Event;

  // Which slot they physically walked into. Null for absence and online records.
  @Index('IDX_attendances_service_slot_id')
  @ManyToOne(() => ServiceSlot, (slot) => slot.attendances, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'service_slot_id' })
  serviceSlot: ServiceSlot | null;

  @Index()
  @Column({ type: 'timestamptz', nullable: true })
  checkinTime: Date;

  @Column()
  status: AttendanceStatusEnum;

  @Column()
  roleAtCheckin: MemberRoleEnum;

  @Column({ type: 'jsonb', name: 'location', nullable: true })
  location: LocationData | null;
}
