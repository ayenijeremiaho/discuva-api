import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';

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
}
