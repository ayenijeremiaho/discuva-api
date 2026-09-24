import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';

@Entity({ name: 'finance_categories' })
export class FinanceCategory extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'character varying', unique: true })
  name: string;

  @Column({ type: 'character varying', nullable: true })
  description: string;

  // Categories already used by a FinanceRequest can't be hard-deleted (see
  // FK RESTRICT on FinanceRequest.category) — this lets an admin retire one
  // from the picker without breaking existing requests that reference it.
  @Column({ type: 'boolean', default: true })
  isActive: boolean;
}
