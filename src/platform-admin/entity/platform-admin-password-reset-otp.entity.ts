import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

// Mirrors auth/entity/password-reset-otp.entity.ts, keyed to a
// PlatformAdmin instead of a Member — kept as a separate table rather than
// a shared one since PlatformAdmin and Member are deliberately disjoint
// identity systems (§4.10).
@Entity('platform_admin_password_reset_otps')
export class PlatformAdminPasswordResetOtp {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  platformAdminId: string;

  @Column()
  otpHash: string;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  usedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
