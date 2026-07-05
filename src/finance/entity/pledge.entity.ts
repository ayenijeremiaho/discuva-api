import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { PledgeFrequency, PledgeStatus } from '../enum/finance.enum';
import { PledgeCampaign } from './pledge-campaign.entity';
import { Member } from '../../member/entity/member.entity';

@Entity('finance_pledges')
export class Pledge extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Member, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'member_id' })
  member: Member | null;

  @Column({ type: 'varchar', nullable: true, name: 'guest_name' })
  guestName: string | null;

  @ManyToOne(() => PledgeCampaign, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'campaign_id' })
  campaign: PledgeCampaign;

  @Column({ type: 'numeric', precision: 15, scale: 2, name: 'total_amount' })
  totalAmount: number;

  @Column({ type: 'varchar' })
  frequency: PledgeFrequency;

  @Column({ type: 'date', name: 'start_date' })
  startDate: string;

  @Column({ type: 'varchar', default: PledgeStatus.ACTIVE })
  status: PledgeStatus;

  @Column({ type: 'text', nullable: true })
  notes: string | null;
}
