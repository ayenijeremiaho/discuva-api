import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { ChurchClass } from './church-class.entity';
import { Member } from '../../member/entity/member.entity';

// Replaces ChurchClass.facilitator (a single Member FK) — a class can have
// several facilitators, and not every facilitator is a registered Member
// (e.g. a guest speaker). Exactly one of member/guestName is set per row,
// enforced in ClassesService rather than a DB constraint (mirrors how
// ClassMaterial's publicId-vs-link split is validated at the service layer).
@Entity({ name: 'class_facilitators' })
export class ClassFacilitator extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @ManyToOne(() => ChurchClass, (c) => c.facilitators, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'church_class_id' })
  churchClass: ChurchClass;

  @Index()
  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'member_id' })
  member: Member | null;

  @Column({ nullable: true, name: 'guest_name' })
  guestName: string | null;

  @Column({ default: 0 })
  order: number;
}
