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

  // Encrypted with CREDENTIALS_ENCRYPTION_KEY; null until the admin opts in.
  @Column({
    type: 'text',
    name: 'two_factor_secret',
    nullable: true,
    select: false,
  })
  twoFactorSecret: string | null;

  @Column({
    type: 'timestamptz',
    name: 'two_factor_enabled_at',
    nullable: true,
  })
  twoFactorEnabledAt: Date | null;

  // Last accepted time step, so a code can't be replayed.
  @Column({
    type: 'int',
    name: 'two_factor_last_step',
    nullable: true,
    select: false,
  })
  twoFactorLastStep: number | null;

  // SHA-256 of each unused code; the codes carry 80 random bits, so no slow hash is needed.
  @Column({
    type: 'text',
    array: true,
    name: 'two_factor_backup_codes',
    nullable: true,
    select: false,
  })
  twoFactorBackupCodes: string[] | null;

  // Remembered devices from before this moment no longer skip the code.
  @Column({
    type: 'timestamptz',
    name: 'two_factor_devices_valid_from',
    nullable: true,
    select: false,
  })
  twoFactorDevicesValidFrom: Date | null;

  // Console tokens issued before this moment stop working.
  @Column({ type: 'timestamptz', name: 'sessions_valid_from', nullable: true })
  sessionsValidFrom: Date | null;

  @Index()
  @Column()
  platformAdminRoleId: string;

  @ManyToOne(() => PlatformAdminRole, (role) => role.admins, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'platform_admin_role_id' })
  platformAdminRole: PlatformAdminRole;
}
