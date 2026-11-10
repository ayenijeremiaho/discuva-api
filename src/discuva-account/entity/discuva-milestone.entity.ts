import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import {
  MilestoneSource,
  MilestoneType,
  MilestoneVisibility,
} from '../enum/milestone.enum';

// A moment in the person's faith life. Church-recorded ones can be hidden by the person but not changed.
@Entity({ name: 'discuva_milestones' })
export class DiscuvaMilestone extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  accountId: string;

  @Column({ type: 'varchar', length: 24 })
  type: MilestoneType;

  @Column({ type: 'varchar', length: 120, nullable: true })
  title: string | null;

  @Column({ type: 'smallint', nullable: true })
  month: number | null;

  @Column({ type: 'smallint', nullable: true })
  year: number | null;

  @Column({ type: 'uuid', nullable: true })
  placeTenantId: string | null;

  @Column({ type: 'varchar', length: 160, nullable: true })
  placeName: string | null;

  @Column({ type: 'varchar', length: 10 })
  source: MilestoneSource;

  @Column({ type: 'uuid', nullable: true })
  sourceTenantId: string | null;

  // Kept so "recorded by" still reads right after that church leaves Discuva.
  @Column({ type: 'varchar', length: 160, nullable: true })
  sourceName: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  sourceRef: string | null;

  @Column({
    type: 'varchar',
    length: 12,
    default: MilestoneVisibility.CHURCHES,
  })
  visibility: MilestoneVisibility;

  @Column({ default: false })
  hidden: boolean;
}
