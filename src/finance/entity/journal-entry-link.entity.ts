import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { JournalLinkRole, JournalLinkType } from '../enum/finance.enum';
import { JournalEntry } from './journal-entry.entity';
import { Member } from '../../member/entity/member.entity';
import { Department } from '../../department/entity/department.entity';
import { ExternalPayee } from './external-payee.entity';

@Entity('finance_journal_entry_links')
export class JournalEntryLink extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => JournalEntry, (entry) => entry.links, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'journal_entry_id' })
  journalEntry: JournalEntry;

  @Column({ type: 'varchar', name: 'link_type' })
  linkType: JournalLinkType;

  @Column({ type: 'varchar' })
  role: JournalLinkRole;

  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'member_id' })
  member: Member | null;

  @ManyToOne(() => Department, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'department_id' })
  department: Department | null;

  @Column({ type: 'uuid', nullable: true, name: 'service_event_id' })
  serviceEventId: string | null;

  // Bare UUID, no relation — mirrors serviceEventId above, deliberately
  // avoiding an import of FinanceRequest (a different module) into this one.
  @Column({ type: 'uuid', nullable: true, name: 'finance_request_id' })
  financeRequestId: string | null;

  @ManyToOne(() => ExternalPayee, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'external_payee_id' })
  externalPayee: ExternalPayee | null;
}
