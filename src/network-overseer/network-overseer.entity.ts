import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseEntity } from '../utility/entity/base.entity';

// An admin of a network's top church who may look inside every branch, read-only.
@Entity({ name: 'network_overseers' })
@Index('uq_network_overseers_member', ['networkRootId', 'memberId'], {
  unique: true,
})
export class NetworkOverseer extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'network_root_id' })
  networkRootId: string;

  // The member behind the admin seat in the top church's own schema.
  @Column({ type: 'uuid', name: 'member_id' })
  memberId: string;

  @Column({ type: 'character varying' })
  name: string;

  @Column({ type: 'character varying' })
  email: string;

  @Column({ type: 'character varying', name: 'added_by_name', nullable: true })
  addedByName: string | null;
}
