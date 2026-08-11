import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { Clergy } from '../../member/entity/clergy.entity';
import { BaseEntity } from '../../utility/entity/base.entity';

// Tenant-configurable clergy title catalog (Lead Pastor, Priest, Bishop,
// Deacon, District Superintendent, ...) — denomination-neutral by design,
// so a tenant isn't locked into Pentecostal/Protestant terminology.
@Entity({ name: 'clergy_titles' })
export class ClergyTitle extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  name: string;

  @Column({ nullable: true })
  description: string | null;

  @OneToMany(() => Clergy, (clergy) => clergy.title)
  clergy: Clergy[];
}
