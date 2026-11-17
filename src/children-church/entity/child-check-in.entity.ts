import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ChildProfile } from './child-profile.entity';
import { ChildGuardian } from './child-guardian.entity';
import { ServiceSlot } from '../../event/entity/service-slot.entity';
import { Member } from '../../member/entity/member.entity';
import { ChildCheckInStatusEnum } from '../enums/child-checkin-status.enum';
import { BaseEntity } from '../../utility/entity/base.entity';

@Entity('child_check_ins')
@Index(['child', 'status'])
export class ChildCheckIn extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @ManyToOne(() => ChildProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'child_id' })
  child: ChildProfile;

  @Index()
  @ManyToOne(() => ServiceSlot, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'service_slot_id' })
  serviceSlot: ServiceSlot | null;

  @ManyToOne(() => ChildGuardian, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'dropped_off_by_id' })
  droppedOffBy: ChildGuardian | null;

  @Column({ nullable: true })
  droppedOffByName: string | null;

  @ManyToOne(() => ChildGuardian, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'picked_up_by_id' })
  pickedUpBy: ChildGuardian | null;

  @Column({ nullable: true })
  pickedUpByName: string | null;

  @Index()
  @Column({ type: 'timestamptz' })
  checkinTime: Date;

  @Column({ type: 'timestamptz', nullable: true })
  checkoutTime: Date | null;

  @Index({ unique: true })
  @Column()
  pickupCode: string;

  @Index()
  @Column({ default: ChildCheckInStatusEnum.CHECKED_IN })
  status: ChildCheckInStatusEnum;

  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'checked_in_by_id' })
  checkedInBy: Member | null;

  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'checked_out_by_id' })
  checkedOutBy: Member | null;

  @Column({ type: 'timestamptz', nullable: true })
  lateNotifiedAt: Date | null;

  // Late-pickup reminders wait for the last service of the day instead of this one.
  @Column({ default: false })
  stayingAllServices: boolean;

  @Column({ nullable: true, type: 'text' })
  flagReason: string | null;
}
