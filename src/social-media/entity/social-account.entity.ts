import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { Admin } from '../../admin/entity/admin.entity';
import { SocialPlatform } from '../enum/social-media.enum';

// A "connected" account today just means the admin has registered which
// page/handle they intend to post to — isConnected only flips to true once
// a real per-platform OAuth flow is wired in (see publisher/ for the
// extension point). Deliberately not storing tokens yet: there's nothing
// to store until a platform integration exists to produce them.
@Entity({ name: 'social_accounts' })
export class SocialAccount extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  platform: SocialPlatform;

  @Column()
  displayName: string;

  @Column({ nullable: true })
  externalAccountId: string | null;

  @Column({ default: false })
  isConnected: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  connectedAt: Date | null;

  @ManyToOne(() => Admin, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'connected_by' })
  connectedBy: Admin | null;
}
