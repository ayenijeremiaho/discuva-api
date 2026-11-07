import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { Exclude } from 'class-transformer';
import { BaseEntity } from '../../utility/entity/base.entity';

// Control-plane table: one sign-in shared by every church a person belongs to.
@Entity({ name: 'discuva_accounts' })
export class DiscuvaAccount extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Always lower case.
  @Index('IDX_discuva_accounts_email', { unique: true })
  @Column()
  email: string;

  @Exclude()
  @Column({ select: false })
  password: string;

  @Exclude()
  @Column({ type: 'varchar', nullable: true, select: false })
  deviceId: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  passwordChangedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  frozenAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  recoveredAt: Date | null;
}
