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

@Entity({ name: 'rota_unavailability' })
@Unique(['member', 'date'])
@Index(['date', 'member'])
export class RotaUnavailability extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Member, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'member_id' })
  member: Member;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'varchar', length: 300, nullable: true })
  reason: string | null;
}
