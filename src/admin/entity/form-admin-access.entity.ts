import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { Form } from '../../forms/entity/form.entity';
import { Admin } from './admin.entity';

@Entity({ name: 'form_admin_access' })
@Index('UQ_form_admin_access_form_admin', ['formId', 'adminId'], {
  unique: true,
})
@Index('IDX_form_admin_access_admin_form', ['adminId', 'formId'])
@Check('CHK_form_admin_access_export_view', 'NOT can_export OR can_view')
export class FormAdminAccess extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'form_id', type: 'uuid' })
  formId: string;

  @ManyToOne(() => Form, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'form_id' })
  form: Form;

  @Column({ name: 'admin_id', type: 'uuid' })
  adminId: string;

  @ManyToOne(() => Admin, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'admin_id' })
  admin: Admin;

  @Column({ name: 'can_view', default: true })
  canView: boolean;

  @Column({ name: 'can_export', default: false })
  canExport: boolean;
}
