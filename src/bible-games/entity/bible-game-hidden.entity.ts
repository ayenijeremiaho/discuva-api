import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { Admin } from '../../admin/entity/admin.entity';

// A generated question an admin hid: an exact question key, or `verse:REF` to hide every question on a verse.
@Entity({ name: 'bible_game_hidden' })
export class BibleGameHidden extends BaseEntity {
  @PrimaryColumn({ type: 'varchar' })
  key: string;

  @Column({ type: 'varchar', nullable: true })
  label: string | null;

  @ManyToOne(() => Admin, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'hidden_by_admin_id' })
  hiddenByAdmin?: Admin | null;

  @Column({ name: 'hidden_by_admin_id', type: 'uuid', nullable: true })
  hiddenByAdminId: string | null;
}
