import { Column, Entity, PrimaryColumn } from 'typeorm';
import { Exclude } from 'class-transformer';
import { BaseEntity } from '../../utility/entity/base.entity';
import { GenderEnum } from '../../member/enums/gender.enum';
import { MaritalStatusEnum } from '../../member/enums/marital-status.enum';
import { AppearanceMode } from '../../member/enums/appearance-mode.enum';

// The person's own basics. Master copy: each linked church's member row is kept in step with it.
@Entity({ name: 'discuva_profiles' })
export class DiscuvaProfile extends BaseEntity {
  @PrimaryColumn('uuid')
  accountId: string;

  @Column()
  firstname: string;

  @Column()
  lastname: string;

  @Column({ type: 'varchar', nullable: true })
  phoneNumber: string | null;

  @Column({ type: 'varchar', nullable: true })
  gender: GenderEnum | null;

  @Column({ type: 'smallint', nullable: true })
  birthDay: number | null;

  @Column({ type: 'smallint', nullable: true })
  birthMonth: number | null;

  @Column({ type: 'smallint', nullable: true })
  birthYear: number | null;

  @Column({ type: 'varchar', nullable: true })
  maritalStatus: MaritalStatusEnum | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  address: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  emergencyContactName: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  emergencyContactPhone: string | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  emergencyContactRelationship: string | null;

  @Column({ type: 'varchar', nullable: true })
  photoUrl: string | null;

  // Stored under the account's own folder, never a church's, so deleting a church can't remove it.
  @Exclude()
  @Column({ type: 'varchar', nullable: true })
  photoPublicId: string | null;

  @Column({ type: 'varchar', default: AppearanceMode.LIGHT })
  appearanceMode: AppearanceMode;

  @Column({ type: 'varchar', array: true, default: '{}' })
  mutedNotifications: string[];
}
