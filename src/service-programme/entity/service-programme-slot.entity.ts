import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { ServiceProgramme } from './service-programme.entity';
import { Member } from '../../member/entity/member.entity';
import { ServiceSlotTypeEnum } from '../enum/service-slot-type.enum';

@Entity({ name: 'service_programme_slots' })
export class ServiceProgrammeSlot extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @ManyToOne(() => ServiceProgramme, (programme) => programme.slots, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'programme_id' })
  programme: ServiceProgramme;

  @Column({ type: 'int' })
  position: number;

  @Column()
  type: ServiceSlotTypeEnum;

  @Column({ nullable: true })
  topic: string | null;

  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'member_id' })
  member: Member | null;

  @Column({ name: 'guest_name', nullable: true })
  guestName: string | null;

  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'backup_member_id' })
  backupMember: Member | null;

  @Column({ name: 'backup_guest_name', nullable: true })
  backupGuestName: string | null;

  @Column({ name: 'allocated_minutes', type: 'int' })
  allocatedMinutes: number;

  @Column({ name: 'reminder_sent_at', type: 'timestamptz', nullable: true })
  reminderSentAt: Date | null;
}
