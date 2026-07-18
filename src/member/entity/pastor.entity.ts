import {
  Column,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Member } from './member.entity';
import { PastorTypeEnum } from '../enums/pastor-type.enum';
import { BaseEntity } from '../../utility/entity/base.entity';

// Independent of WorkerProfile/Department on purpose — a pastor may have no
// department (e.g. a Lead Pastor) or may separately also be an HOD.
@Entity({ name: 'pastors' })
export class Pastor extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => Member, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'member_id' })
  member: Member;

  @Column({ type: 'varchar' })
  type: PastorTypeEnum;
}
