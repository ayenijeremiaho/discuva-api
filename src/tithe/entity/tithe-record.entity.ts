import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { Member } from '../../member/entity/member.entity';
import { TitheUploadBatch } from './tithe-upload-batch.entity';
import { TitheSource } from '../../finance/enum/finance.enum';

@Entity({ name: 'tithe_records' })
@Index('IDX_tithe_records_member_payment', ['member', 'paymentDate'])
export class TitheRecord extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @ManyToOne(() => Member, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'member_id' })
  member: Member;

  @Index('IDX_tithe_records_batch_id')
  @ManyToOne(() => TitheUploadBatch, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'batch_id' })
  batch: TitheUploadBatch | null;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  amount: number;

  @Column({ type: 'date' })
  paymentDate: string;

  @Column({ type: 'character varying', nullable: true })
  reference: string;

  @Column({ type: 'character varying', nullable: true })
  bankName: string;

  @Column({ type: 'varchar', default: TitheSource.MANUAL_PROOF })
  source: TitheSource;

  @Column({ type: 'varchar', nullable: true, name: 'external_reference' })
  externalReference: string | null;

  @Column({ type: 'varchar', nullable: true, name: 'payment_channel' })
  paymentChannel: string | null;
}
