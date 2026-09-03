import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';

// One row per upload to POST forms/:formId/fields/:fieldId/attachment —
// pure orphan-tracking bookkeeping, not a real relation to Form/FormField
// (plain UUID columns, no @ManyToOne — avoids resurrecting the Form/
// FormField cyclic-dependency issue documented on Form.fields for no
// benefit, since nothing here ever needs to join back to those entities).
// FormSubmissionService.saveSubmission deletes the row for every FILE
// answer actually referenced by a successful submission; FormAttachment
// CleanupScheduler sweeps whatever's left after a form-submission-sized
// grace window — its mere continued existence past that cutoff IS the
// signal that the upload was abandoned, since a claimed row is deleted
// immediately.
@Entity({ name: 'form_field_attachments' })
export class FormFieldAttachment extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'form_id' })
  formId: string;

  @Column({ name: 'field_id' })
  fieldId: string;

  @Index('IDX_form_field_attachments_public_id')
  @Column({ name: 'public_id' })
  publicId: string;

  @Column()
  url: string;

  // Cloudinary's deleteByPublicId requires the same resource_type used at
  // upload ('image' | 'video' | 'raw', see CloudinaryService) — captured
  // here so the cleanup sweep can delete correctly without re-deriving it
  // from a mimetype no longer available at sweep time.
  @Column({ name: 'resource_type' })
  resourceType: string;
}
