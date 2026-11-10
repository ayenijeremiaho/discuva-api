import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

// Which church member record belongs to which account. Plain ids: the member lives in that church's schema.
@Entity({ name: 'discuva_account_links' })
@Index('IDX_discuva_account_links_tenant_member', ['tenantId', 'memberId'], {
  unique: true,
})
export class DiscuvaAccountLink {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_discuva_account_links_account')
  @Column({ type: 'uuid' })
  accountId: string;

  @Column({ type: 'uuid' })
  tenantId: string;

  @Column({ type: 'uuid' })
  memberId: string;

  @CreateDateColumn({ type: 'timestamptz' })
  linkedAt: Date;

  // When the person agreed to share their Discuva profile with this church.
  @Column({ type: 'timestamptz', nullable: true })
  consentedAt: Date | null;
}
