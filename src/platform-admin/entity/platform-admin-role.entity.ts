import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { PlatformAdminPermission } from '../enum/platform-admin-permission.enum';
import { PlatformAdmin } from './platform-admin.entity';
import { BaseEntity } from '../../utility/entity/base.entity';

// Control-plane table — lives in `public`, never a `search_path` target.
// Mirrors src/admin/entity/admin-role.entity.ts's shape exactly, but for
// the separate platform-admin identity system (PlatformAdminGuard, not
// AdminGuard) — see PlatformAdminPermission's own comment for why these
// stay two disjoint enums/tables rather than one shared one.
@Entity({ name: 'platform_admin_roles' })
export class PlatformAdminRole extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  name: string;

  @Column({ nullable: true })
  description: string;

  @Column({ type: 'text', array: true, default: '{}' })
  permissions: PlatformAdminPermission[];

  @OneToMany(() => PlatformAdmin, (admin) => admin.platformAdminRole)
  admins: PlatformAdmin[];
}
