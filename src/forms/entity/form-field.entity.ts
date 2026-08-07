import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { FormFieldAutoFill, FormFieldType } from '../enum/form.enum';
import { Form } from './form.entity';

@Entity({ name: 'form_fields' })
export class FormField extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_form_fields_form_id')
  @ManyToOne(() => Form, (form) => form.fields, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'form_id' })
  form: Form;

  @Column()
  label: string;

  @Column({ default: FormFieldType.TEXT })
  fieldType: FormFieldType;

  @Column({ default: false })
  required: boolean;

  // Choices for DROPDOWN/CHECKBOX — null for every other field type.
  @Column({ type: 'text', array: true, nullable: true })
  options: string[] | null;

  @Column({ type: 'smallint', default: 0 })
  order: number;

  @Column({ nullable: true })
  autoFillKey: FormFieldAutoFill | null;
}
