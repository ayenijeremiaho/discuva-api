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
import { GivingOption } from '../../finance/entity/giving-option.entity';

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

  // Only set for PAYMENT_GATEWAY rows where the member designated a
  // purpose at checkout — null means "General Giving" (no forced default
  // row, mirrors how an omitted TitheAccount is handled).
  @Index('IDX_tithe_records_giving_option_id')
  @ManyToOne(() => GivingOption, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'giving_option_id' })
  givingOption: GivingOption | null;
}
