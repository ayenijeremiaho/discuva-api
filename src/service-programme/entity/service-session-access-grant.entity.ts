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

@Entity({ name: 'service_session_access_grants' })
export class ServiceSessionAccessGrant extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @ManyToOne(() => ServiceSession, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'session_id' })
  session: ServiceSession;

  @Column()
  name: string;

  @Column({ name: 'pin_hash' })
  pinHash: string;

  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'granted_by_member_id' })
  grantedByMember: Member | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @Column({ name: 'last_used_at', type: 'timestamptz', nullable: true })
  lastUsedAt: Date | null;
}
