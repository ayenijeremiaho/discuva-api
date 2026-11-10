import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { FirstTimerFieldType } from '../enums/follow-up.enum';

// A question on the church's first-timer card, beyond the fixed ones (name, phone, service, joining).
@Entity({ name: 'first_timer_fields' })
export class FirstTimerField extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Set on the ready-made fields, which can be switched off but not deleted; null on the church's own.
  @Column({ type: 'varchar', length: 40, nullable: true, unique: true })
  key: string | null;

  @Column({ type: 'varchar', length: 120 })
  label: string;

  @Column({ type: 'varchar', length: 16 })
  type: FirstTimerFieldType;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  options: string[];

  @Column({ default: false })
  enabled: boolean;

  @Column({ default: false })
  required: boolean;

  @Column({ name: 'in_report', default: true })
  inReport: boolean;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;
}
