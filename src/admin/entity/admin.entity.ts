import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AdminPermission } from '../enum/admin-permission.enum';
import { Member } from '../../member/entity/member.entity';
import { AdminRole } from './admin-role.entity';
import { BaseEntity } from '../../utility/entity/base.entity';

@Entity({ name: 'admins' })
export class Admin extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @OneToOne(() => Member, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'member_id' })
  member: Member;

  @Index()
  @ManyToOne(() => AdminRole, (role) => role.admins, {
    onDelete: 'RESTRICT',
    eager: false,
  })
  @JoinColumn({ name: 'admin_role_id' })
  adminRole: AdminRole;

  @Column({
    name: 'additional_permissions',
    type: 'text',
    array: true,
    default: '{}',
  })
  additionalPermissions: AdminPermission[];

  effectivePermissions?: AdminPermission[];
  accessGrantsEnabled?: boolean;
  hasAssignedForms?: boolean;

  @Column({ default: true })
  isActive: boolean;

  // Holds the account for the church: billing, admins, handover.
  @Column({ name: 'is_owner', default: false })
  isOwner: boolean;

  @Column({ type: 'timestamptz', name: 'owner_invited_at', nullable: true })
  ownerInvitedAt: Date | null;

  @Index()
  @ManyToOne(() => Admin, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'owner_invited_by_id' })
  ownerInvitedBy: Admin | null;

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

  // Admin-portal routes pinned to the dashboard's Quick Access, in the admin's own order.
  @Column({ type: 'jsonb', default: () => "'[]'" })
  favouritePages: string[];
}
