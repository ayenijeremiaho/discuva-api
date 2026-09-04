import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { PageSectionType } from '../enum/page.enum';

// { id, type, content } — `id` is client-generated (uuid), not a DB row id:
// sections live in a plain jsonb array (no relation), so there's nothing for
// TypeORM to assign an id to. `content`'s shape depends on `type` and is
// validated in PageService.assertValidSection (a switch per type), the same
// pattern Form.postSubmitOutcomes/optionMetadata already use for jsonb
// content a decorator alone can't cross-check — see PageSectionDto's own
// comment for why this isn't a class-transformer discriminated union.
export interface PageSection {
  id: string;
  type: PageSectionType;
  content: Record<string, unknown>;
}

@Entity({ name: 'pages' })
export class Page extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Url-safe (^[a-z0-9-]+$), unique per tenant schema — this is what a
  // church shares in an ad: member.<subdomain>.<baseDomain>/p/<slug>.
  @Index({ unique: true })
  @Column()
  slug: string;

  @Column()
  title: string;

  // Falls back to a generic description when unset — see
  // PagePublicController's generateMetadata precedent on the member app
  // side for how this feeds Open Graph/Twitter Card previews.
  @Column({ name: 'seo_description', nullable: true })
  seoDescription: string | null;

  @Column({ name: 'og_image_url', nullable: true })
  ogImageUrl: string | null;

  @Column({ name: 'og_image_public_id', nullable: true })
  ogImagePublicId: string | null;

  // A page is only reachable at GET pages/public/:slug once true — lets an
  // admin build/save a draft without it going live. No separate "draft
  // preview" mechanism for v1 (see the Pages plan's own scope notes).
  @Column({ name: 'is_published', default: false })
  isPublished: boolean;

  // Whole-array replace on every save (like Form.postSubmitOutcomes, not
  // diff-synced like Form.fields) — there's no per-section DB row to diff
  // against, and the builder always sends the complete current array.
  @Column({ type: 'jsonb', default: [] })
  sections: PageSection[];
}
