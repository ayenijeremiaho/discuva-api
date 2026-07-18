import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('email_change_otps')
export class EmailChangeOtp {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  memberId: string;

  @Column()
  otpHash: string;

  // The new email to apply on successful verification — locked in at request
  // time, same reasoning as DeviceResetOtp.newDeviceId.
  @Column()
  newEmail: string;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  usedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
