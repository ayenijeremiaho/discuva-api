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
import { Group } from './group.entity';

// A row is either a real Member (member set, phoneNumber/label null) or a
// phone-only entry (member null, phoneNumber set) — e.g. a manually-typed
// number or one imported from a FirstTimer who has no Member account.
// Enforced with a CHECK constraint in the migration, not just app logic.
@Entity('group_members')
@Unique(['group', 'member'])
@Unique(['group', 'phoneNumber'])
export class GroupMember extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @ManyToOne(() => Group, { nullable: false, onDelete: 'CASCADE' })
  group: Group;

  @Index()
  @ManyToOne(() => Member, { nullable: true, onDelete: 'CASCADE' })
  member: Member | null;

  @Column({ nullable: true })
  phoneNumber: string | null;

  @Column({ nullable: true })
  label: string | null;

  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  addedBy: Member | null;
}
