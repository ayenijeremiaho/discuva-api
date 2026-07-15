import {
  Column,
  Entity,
  Index,
  JoinColumn,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { ServiceProgramme } from './service-programme.entity';
import { ServiceSessionStatusEnum } from '../enum/service-session-status.enum';
import { ServiceSessionSlot } from './service-session-slot.entity';
import { ServicePauseEntry } from './service-pause-entry.entity';
import { ServiceActionEntry } from './service-action-entry.entity';
import { ServiceSessionAccessGrant } from './service-session-access-grant.entity';

@Entity({ name: 'service_sessions' })
export class ServiceSession extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @OneToOne(() => ServiceProgramme, (programme) => programme.session, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'programme_id' })
  programme: ServiceProgramme;

  @Index({ unique: true })
  @Column({ name: 'session_code' })
  sessionCode: string;

  @Column({ default: ServiceSessionStatusEnum.LIVE })
  status: ServiceSessionStatusEnum;

  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt: Date;

  @Column({ name: 'ended_at', type: 'timestamptz', nullable: true })
  endedAt: Date | null;

  @OneToMany(() => ServiceSessionSlot, (slot) => slot.session)
  sessionSlots: ServiceSessionSlot[];

  @OneToMany(() => ServicePauseEntry, (entry) => entry.session)
  pauseEntries: ServicePauseEntry[];

  @OneToMany(() => ServiceActionEntry, (entry) => entry.session)
  actionEntries: ServiceActionEntry[];

  @OneToMany(() => ServiceSessionAccessGrant, (grant) => grant.session)
  accessGrants: ServiceSessionAccessGrant[];
}
