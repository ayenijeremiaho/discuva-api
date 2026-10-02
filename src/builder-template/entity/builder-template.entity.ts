import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { BuilderTemplateKind } from '../enum/builder-template-kind.enum';

@Entity({ name: 'builder_templates' })
export class BuilderTemplate extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'varchar', length: 32 })
  kind: BuilderTemplateKind;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'varchar', length: 240, nullable: true })
  description: string | null;

  @Column({ type: 'jsonb' })
  data: Record<string, unknown>;
}
