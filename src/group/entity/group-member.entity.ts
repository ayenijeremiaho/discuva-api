import {
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { Member } from '../../member/entity/member.entity';
import { Group } from './group.entity';

@Entity('group_members')
@Unique(['group', 'member'])
export class GroupMember extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @ManyToOne(() => Group, { nullable: false, onDelete: 'CASCADE' })
  group: Group;

  @Index()
  @ManyToOne(() => Member, { nullable: false, onDelete: 'CASCADE' })
  member: Member;

  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  addedBy: Member | null;
}
