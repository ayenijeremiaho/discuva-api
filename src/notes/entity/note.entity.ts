import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { NoteTypeEnum } from '../enums/note-type.enums';
import { NoteDetails } from '../types/note-details.type';
import { Transform } from 'class-transformer';
import { BaseEntity } from '../../utility/entity/base.entity';
import { Member } from '../../member/entity/member.entity';

@Entity({ name: 'notes' })
export class Note extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  type: NoteTypeEnum;

  @Column({ type: 'json', name: 'details' })
  @Transform(({ value }) => JSON.parse(JSON.stringify(value)), {
    toPlainOnly: true,
  })
  details: NoteDetails;

  // Optional — most naming/dedication records are for someone not yet in the
  // system (e.g. a newborn). When set, the record becomes visible on that
  // member's own profile (GET /members/me/milestones).
  @Index()
  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'member_id' })
  member: Member | null;
}
