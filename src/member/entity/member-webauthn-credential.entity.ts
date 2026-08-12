import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Member } from './member.entity';
import { BaseEntity } from '../../utility/entity/base.entity';

// One row per registered device/authenticator — deliberately no unique
// constraint on member (unlike MemberSession's one-per-surface rule), since
// a member can register a phone, a laptop, etc. independently.
@Entity({ name: 'member_webauthn_credentials' })
export class MemberWebauthnCredential extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'member_id' })
  memberId: string;

  @ManyToOne(() => Member, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'member_id' })
  member: Member;

  // Base64url credential ID from the authenticator — how a login assertion
  // is matched back to a stored public key, before the member is known.
  @Index({ unique: true })
  @Column()
  credentialId: string;

  // Base64-encoded COSE public key (@simplewebauthn/server's
  // WebAuthnCredential.publicKey as a Buffer) — never a secret, this is
  // what verifies a signature, not what produces one.
  @Column({ type: 'text' })
  publicKey: string;

  // Signature counter — must only ever increase. A same-or-lower value on a
  // later login is the standard clone/replay-detection signal.
  @Column({ type: 'bigint', default: 0 })
  counter: number;

  @Column({ type: 'text', array: true, default: '{}' })
  transports: string[];

  // Derived from User-Agent at registration time, e.g. "iPhone — Safari" —
  // purely a label so a member can tell their devices apart when managing
  // them, never used for anything security-relevant.
  @Column({ nullable: true })
  deviceName: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastUsedAt: Date | null;
}
