import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { Event } from '../../event/entity/event.entity';
import { FormVisibility } from '../enum/form.enum';
import { FormField } from './form-field.entity';
import { FormSubmission } from './form-submission.entity';

@Entity({ name: 'forms' })
export class Form extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  title: string;

  @Column({ nullable: true })
  description: string | null;

  @Index()
  @Column({ default: FormVisibility.MEMBERS })
  visibility: FormVisibility;

  @Index('IDX_forms_event_id')
  @ManyToOne(() => Event, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'event_id' })
  event: Event | null;

  @Index()
  @Column({ default: true })
  isActive: boolean;

  // When true, a public submission to this form also creates a FirstTimer
  // record (source=ONLINE) — the online-intake counterpart to a physical
  // walk-in, reachable via a QR code/shared link rather than someone at
  // the door. Only meaningful on a PUBLIC-visibility form; enforced at
  // create/update time (see FormService).
  @Column({ name: 'creates_first_timers', default: false })
  createsFirstTimers: boolean;

  @OneToMany(() => FormField, (field) => field.form, {
    cascade: true,
    eager: true,
  })
  fields: FormField[];

  @OneToMany(() => FormSubmission, (submission) => submission.form)
  submissions: FormSubmission[];
}
