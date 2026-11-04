import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../utility/entity/base.entity';
import { PlatformAdmin } from '../platform-admin/entity/platform-admin.entity';

@Entity({ name: 'protected_names' })
export class ProtectedName extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Column({ name: 'short_forms', type: 'text', array: true, default: '{}' })
  shortForms: string[];

  @Column({ type: 'text', array: true, default: '{}' })
  addresses: string[];

  @Column({ type: 'varchar', length: 300, nullable: true })
  note: string | null;

  @Column({ type: 'uuid', name: 'updated_by_id', nullable: true })
  updatedById: string | null;

  @ManyToOne(() => PlatformAdmin, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'updated_by_id' })
  updatedBy: PlatformAdmin | null;
}
