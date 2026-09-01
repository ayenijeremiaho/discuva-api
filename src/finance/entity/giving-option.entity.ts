import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { Fund } from './fund.entity';

// Donor-facing "what is this gift for" selector for online giving-checkout
// (Tithe, Offering, General Giving, Building Fund, etc.) — deliberately
// separate from Fund, which is back-office accounting data (restricted vs.
// unrestricted net assets, chart-of-accounts scoping) never shown to a
// member. Each option carries an admin-set Fund for accounting purposes
// only; the member never sees fund.id/fund.type, matching how
// PledgeCampaign already surfaces only fundName as a display string.
@Entity('finance_giving_options')
export class GivingOption extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @ManyToOne(() => Fund, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'fund_id' })
  fund: Fund | null;

  @Column({ type: 'boolean', default: true, name: 'is_active' })
  isActive: boolean;
}
