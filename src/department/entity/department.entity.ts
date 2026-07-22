import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { WorkerProfile } from '../../member/entity/worker-profile.entity';
import { BaseEntity } from '../../utility/entity/base.entity';

@Entity({ name: 'departments' })
export class Department extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  name: string;

  @Column()
  description: string;

  /**
   * Access category key. Multiple departments can share the same key, granting
   * workers in all of them access to features gated on that key.
   * e.g. "Technical Media" and "Social Media" can both carry key=MEDIA.
   * Null means no system-level access category is assigned. Free-form string,
   * not a fixed enum — DepartmentKeyEnum/DepartmentKeyLabels (see
   * department-key.enum.ts) are preset suggestions offered by the frontend
   * picker, not the full set of valid values. New access categories can be
   * created by simply typing a new key, no backend change required.
   */
  @Column({ nullable: true, default: null })
  key: string | null;

  @OneToMany(() => WorkerProfile, (profile) => profile.department)
  workerProfiles: WorkerProfile[];
}
