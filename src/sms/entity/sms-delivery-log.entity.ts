import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';

@Entity({ name: 'sms_delivery_logs' })
@Index('IDX_sms_delivery_logs_provider_message_recipient', [
  'provider',
  'providerMessageId',
  'recipient',
])
export class SmsDeliveryLog extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  provider: string;

  @Column()
  recipient: string;

  @Column({ type: 'text' })
  message: string;

  @Column()
  status: string;

  @Column({ name: 'provider_message_id', nullable: true })
  providerMessageId: string | null;

  @Column({ name: 'provider_status', nullable: true })
  providerStatus: string | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ name: 'source_type', default: 'direct' })
  sourceType: string;

  @Column({ name: 'source_id', type: 'uuid', nullable: true })
  sourceId: string | null;

  @Column({ name: 'source_label', nullable: true })
  sourceLabel: string | null;
}
