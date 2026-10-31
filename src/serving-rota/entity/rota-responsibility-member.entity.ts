import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { Member } from '../../member/entity/member.entity';
import { RotaResponsibility } from './rota-responsibility.entity';

@Entity({ name: 'rota_responsibility_members' })
@Unique(['responsibility', 'member'])
@Index(['member', 'responsibility'])
export class RotaResponsibilityMember extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => RotaResponsibility, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'responsibility_id' })
  responsibility: RotaResponsibility;

  @ManyToOne(() => Member, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'member_id' })
  member: Member;

  @Column({ name: 'is_fixed', default: false })
  isFixed: boolean;
}
