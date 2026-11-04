import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';

export enum TeamSpaceKindEnum {
  DEPARTMENT = 'DEPARTMENT',
  FELLOWSHIP = 'FELLOWSHIP',
  VOLUNTEERING = 'VOLUNTEERING',
  SHARED = 'SHARED',
  COMMUNITY = 'COMMUNITY',
}

// One Community space per account, so its ref is fixed.
export const COMMUNITY_REF_ID = '00000000-0000-0000-0000-000000000000';

// A department's, fellowship's or volunteering opportunity's shared space. Membership isn't stored: it follows the roster.
@Entity({ name: 'team_spaces' })
@Unique(['kind', 'refId'])
export class TeamSpace extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  kind: TeamSpaceKindEnum;

  // The department's, fellowship's or volunteering opportunity's id.
  @Column({ type: 'uuid', name: 'ref_id' })
  refId: string;

  @Column({ default: false })
  leadersOnly: boolean;

  @Index()
  @Column({ type: 'timestamptz', nullable: true })
  lastActivityAt: Date | null;
}
