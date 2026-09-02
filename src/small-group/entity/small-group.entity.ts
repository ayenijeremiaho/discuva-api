import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { Member } from '../../member/entity/member.entity';
import { Admin } from '../../admin/entity/admin.entity';
import { Venue } from '../../venue/entity/venue.entity';
import { MeetingFormatEnum } from '../../utility/enum/meeting-format.enum';

@Entity({ name: 'small_groups' })
export class SmallGroup extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', unique: true })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  // A cell leader isn't necessarily a Worker/Admin — any member can lead.
  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'leader_id' })
  leader: Member | null;

  @Column({ type: 'varchar', nullable: true, name: 'meeting_day' })
  meetingDay: string | null;

  @Column({ type: 'varchar', nullable: true, name: 'meeting_location' })
  meetingLocation: string | null;

  // Informational link to a registered Venue — kept alongside the free-text
  // meetingLocation above (most fellowships meet informally, e.g. a
  // member's home, with no registered Venue row) rather than replacing it.
  // SET NULL, not RESTRICT: unlike EventConfig.defaultVenue, losing this
  // link on venue deletion is fine — it's metadata, not a resolution
  // dependency anything else relies on.
  @ManyToOne(() => Venue, {
    nullable: true,
    eager: false,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'venue_id' })
  venue: Venue | null;

  @Column({
    type: 'varchar',
    name: 'meeting_format',
    default: MeetingFormatEnum.IN_PERSON,
  })
  meetingFormat: MeetingFormatEnum;

  @Column({ type: 'varchar', nullable: true, name: 'meeting_link' })
  meetingLink: string | null;

  @ManyToOne(() => Admin, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by_id' })
  createdBy: Admin | null;
}
