import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { Admin } from '../../admin/entity/admin.entity';
import { Department } from '../../department/entity/department.entity';
import { ChurchClass } from '../../classes/entity/church-class.entity';
import { GameStatusEnum } from '../enum/game-status.enum';

@Entity('games')
export class Game extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'varchar', default: GameStatusEnum.DRAFT })
  status: GameStatusEnum;

  @ManyToOne(() => Admin, { nullable: true, onDelete: 'SET NULL' })
  createdBy: Admin | null;

  // Categorization only, per product decision — games are open to anyone
  // with the join code regardless of department/class. Not used for access
  // control, only for reporting/filtering in the admin portal.
  @ManyToOne(() => Department, { nullable: true, onDelete: 'SET NULL' })
  department: Department | null;

  @ManyToOne(() => ChurchClass, { nullable: true, onDelete: 'SET NULL' })
  churchClass: ChurchClass | null;
}
