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
import { VolunteerOpportunity } from './volunteer-opportunity.entity';
import { Member } from '../../member/entity/member.entity';
import { VolunteerSignupStatusEnum } from '../enum/volunteer-signup-status.enum';

@Entity({ name: 'volunteer_signups' })
@Unique(['opportunity', 'member'])
export class VolunteerSignup extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @ManyToOne(() => VolunteerOpportunity, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'opportunity_id' })
  opportunity: VolunteerOpportunity;

  @ManyToOne(() => Member, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'member_id' })
  member: Member;

  @Column({
    type: 'varchar',
    default: VolunteerSignupStatusEnum.CONFIRMED,
  })
  status: VolunteerSignupStatusEnum;
}
