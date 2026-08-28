import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { ChurchClass } from './church-class.entity';

// Replaces ChurchClass.documentUrl (a single free-text URL, never a real
// upload — the old uploadMaterial() discarded Cloudinary's publicId, so
// nothing could ever be deleted). Multiple titled materials per class, each
// either a real Cloudinary upload (publicId set) or a pasted external link
// (publicId null — nothing to clean up on delete). A publicId can be shared
// across multiple rows via ClassesService's "reuse a previous material"
// flow — see cleanupMaterialAsset(), which only deletes the Cloudinary
// asset once no other row references the same publicId.
@Entity({ name: 'class_materials' })
export class ClassMaterial extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @ManyToOne(() => ChurchClass, (c) => c.materials, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'church_class_id' })
  churchClass: ChurchClass;

  @Column()
  title: string;

  @Column()
  url: string;

  @Index()
  @Column({ nullable: true, name: 'public_id' })
  publicId: string | null;

  @Column({ nullable: true, name: 'resource_type' })
  resourceType: string | null;

  @Column({ nullable: true, name: 'mime_type' })
  mimeType: string | null;

  @Column({ type: 'bigint', nullable: true, name: 'size_bytes' })
  sizeBytes: number | null;

  @Column({ default: 0 })
  order: number;
}
