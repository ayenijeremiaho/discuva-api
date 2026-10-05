import {
  Column,
  Entity,
  Index,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
  PrimaryGeneratedColumn,
  RelationId,
} from 'typeorm';
import { Member } from '../../member/entity/member.entity';
import { BaseEntity } from '../../utility/entity/base.entity';

// One outing; converts added during it share its team, so the team is recorded once.
@Entity({ name: 'outreaches' })
export class Outreach extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', nullable: true })
  title: string | null;

  @Column({ type: 'varchar', nullable: true })
  location: string | null;

  @Index()
  @Column({ name: 'outreach_date', type: 'date' })
  outreachDate: string;

  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by' })
  createdBy: Member | null;

  @RelationId((o: Outreach) => o.createdBy)
  createdById: string | null;

  @Column({ name: 'created_by_name' })
  createdByName: string;

  @ManyToMany(() => Member)
  @JoinTable({
    name: 'outreach_team',
    joinColumn: { name: 'outreach_id' },
    inverseJoinColumn: { name: 'member_id' },
  })
  team?: Member[];
}
