import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';

export enum SharedSpaceAudienceEnum {
  CUSTOM = 'CUSTOM',
  ALL_WORKERS = 'ALL_WORKERS',
  LEADERS = 'LEADERS',
}

// A space across teams. Who's in it follows the chosen rosters, plus anyone added by name.
@Entity({ name: 'shared_spaces' })
export class SharedSpace extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'varchar' })
  audience: SharedSpaceAudienceEnum;

  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  archivedAt: Date | null;
}
