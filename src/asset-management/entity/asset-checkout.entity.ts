import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Asset } from './asset.entity';
import { Member } from '../../member/entity/member.entity';
import { Department } from '../../department/entity/department.entity';
import { Admin } from '../../admin/entity/admin.entity';

@Entity('asset_checkouts')
export class AssetCheckout {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_asset_checkouts_asset_id')
  @ManyToOne(() => Asset, (asset) => asset.checkouts, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'asset_id' })
  asset: Asset;

  @ManyToOne(() => Member, {
    nullable: true,
    onDelete: 'SET NULL',
    eager: false,
  })
  @JoinColumn({ name: 'checked_out_to_member_id' })
  checkedOutToMember: Member | null;

  @ManyToOne(() => Department, {
    nullable: true,
    onDelete: 'SET NULL',
    eager: false,
  })
  @JoinColumn({ name: 'checked_out_to_department_id' })
  checkedOutToDepartment: Department | null;

  @Column({ type: 'timestamptz', name: 'checked_out_at' })
  checkedOutAt: Date;

  @Column({ type: 'timestamptz', nullable: true, name: 'expected_return_at' })
  expectedReturnAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'returned_at' })
  returnedAt: Date | null;

  @Column({ type: 'varchar', nullable: true })
  purpose: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @ManyToOne(() => Admin, {
    nullable: false,
    onDelete: 'RESTRICT',
    eager: false,
  })
  @JoinColumn({ name: 'checked_out_by_admin_id' })
  checkedOutBy: Admin;

  @ManyToOne(() => Admin, {
    nullable: true,
    onDelete: 'SET NULL',
    eager: false,
  })
  @JoinColumn({ name: 'returned_by_admin_id' })
  returnedBy: Admin | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
