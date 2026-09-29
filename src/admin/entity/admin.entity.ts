import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
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

  @Column({ default: true })
  isActive: boolean;

  // Admin-portal routes pinned to the dashboard's Quick Access, in the admin's own order.
  @Column({ type: 'jsonb', default: () => "'[]'" })
  favouritePages: string[];
}
