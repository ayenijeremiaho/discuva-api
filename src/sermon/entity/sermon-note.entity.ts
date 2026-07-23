import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Sermon } from './sermon.entity';
import { Member } from '../../member/entity/member.entity';
import { BaseEntity } from '../../utility/entity/base.entity';

@Entity({ name: 'sermon_notes' })
@Unique(['sermon', 'member'])
export class SermonNote extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @ManyToOne(() => Sermon, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sermon_id' })
  sermon: Sermon;

  @ManyToOne(() => Member, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'member_id' })
  member: Member;

  @Column({ type: 'text' })
  note: string;
}
