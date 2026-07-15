import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { ServiceSession } from './service-session.entity';
import { Member } from '../../member/entity/member.entity';
import { ServiceActionRoleEnum } from '../enum/service-action-role.enum';

@Entity({ name: 'service_action_entries' })
export class ServiceActionEntry extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @ManyToOne(() => ServiceSession, (session) => session.actionEntries, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'session_id' })
  session: ServiceSession;

  @Column({ name: 'actor_role' })
  actorRole: ServiceActionRoleEnum;

  @Column()
  action: string;

  @Column({ nullable: true })
  detail: string | null;

  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'performed_by_member_id' })
  performedByMember: Member | null;

  // Free-text name for a named public-link actor (via ServiceSessionAccessGrant) —
  // distinct from performedByMember, which only applies to real Member/Worker actors.
  @Column({ name: 'actor_label', nullable: true })
  actorLabel: string | null;
}
