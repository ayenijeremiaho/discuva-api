import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { PlatformAdminRole } from './platform-admin-role.entity';

// Control-plane table — lives in `public`, never a `search_path` target.
// Deliberately a separate identity system from Member/Admin (§4.10) — a
// platform admin operates the SaaS itself, not any one church.
@Entity({ name: 'platform_admins' })
export class PlatformAdmin extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column()
  email: string;

  @Column({ select: false })
  passwordHash: string;

  @Column({ default: true })
  isActive: boolean;

  // false when a random password was generated on this admin's behalf
  // (onboarded without a caller-supplied password — see
  // PlatformAdminManagementService.create()) and they haven't set a real
  // one yet via the OTP-based welcome flow. Mirrors Member.changedPassword.
  @Column({ default: true })
  changedPassword: boolean;

  @Index()
  @Column()
  platformAdminRoleId: string;

  @ManyToOne(() => PlatformAdminRole, (role) => role.admins, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'platform_admin_role_id' })
  platformAdminRole: PlatformAdminRole;
}
