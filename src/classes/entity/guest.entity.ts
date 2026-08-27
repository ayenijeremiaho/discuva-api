import {
  Column,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { Member } from '../../member/entity/member.entity';

// A non-member taking a Training Class — e.g. a visitor's spouse in
// marriage counselling. Deliberately its own entity, not inline columns on
// ClassEnrollment: a guest is a repeat, evolving identity that may take
// several classes over time, so contact details are stored once here and
// referenced from each enrollment, rather than duplicated (and risking
// staleness) per enrollment row.
@Entity('guests')
@Unique(['email'])
export class Guest extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'first_name' })
  firstName: string;

  @Column({ name: 'last_name' })
  lastName: string;

  @Index()
  @Column()
  email: string;

  @Column({ nullable: true })
  phone: string | null;

  @Column({ name: 'church_name', nullable: true })
  churchName: string | null;

  @Column({ nullable: true })
  address: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  // Set once this guest converts to a full Member — kept as a permanent
  // historical link even though ClassEnrollment.member also gets updated
  // directly at conversion time (see ClassesService.convertGuestToMember),
  // so downstream reads never need to know about this relationship, only
  // "does this enrollment have a member."
  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  convertedMember: Member | null;
}
