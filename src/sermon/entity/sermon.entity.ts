import {
  Column,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { Admin } from '../../admin/entity/admin.entity';

@Entity('sermons')
export class Sermon extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  title: string;

  @Column({ type: 'varchar', name: 'speaker_name' })
  speakerName: string;

  @Index()
  @Column({ type: 'timestamptz' })
  date: Date;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'varchar', nullable: true, name: 'youtube_url' })
  youtubeUrl: string | null;

  @Column({ type: 'varchar', nullable: true, name: 'mixlr_url' })
  mixlrUrl: string | null;

  @Index()
  @Column({ type: 'varchar', nullable: true })
  series: string | null;

  @ManyToOne(() => Admin, { nullable: true, onDelete: 'SET NULL' })
  createdBy: Admin | null;
}
