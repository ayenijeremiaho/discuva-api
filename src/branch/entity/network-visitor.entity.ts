import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { Event } from '../../event/entity/event.entity';
import { ServiceSlot } from '../../event/entity/service-slot.entity';

// Someone from another branch of the network at this church's service. Name and photo only; not a member here.
@Entity({ name: 'network_visitors' })
@Unique('uq_network_visitors_event_account', ['event', 'accountId'])
export class NetworkVisitor extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Event, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'event_id' })
  event: Event;

  @ManyToOne(() => ServiceSlot, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'service_slot_id' })
  serviceSlot: ServiceSlot | null;

  @Column({ type: 'uuid', name: 'account_id' })
  accountId: string;

  @Column({ type: 'uuid', name: 'from_tenant_id' })
  fromTenantId: string;

  @Column({ type: 'varchar' })
  firstname: string;

  @Column({ type: 'varchar' })
  lastname: string;

  @Column({ type: 'varchar', name: 'photo_url', nullable: true })
  photoUrl: string | null;

  @Column({ type: 'timestamptz', name: 'checkin_time' })
  checkinTime: Date;
}
