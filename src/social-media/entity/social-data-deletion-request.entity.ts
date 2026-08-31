import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { SocialPlatform } from '../enum/social-media.enum';

// Control-plane table — lives in `public`, never a `search_path` target.
// Meta's Data Deletion Callback has no tenant context at all (same
// no-Host-header reasoning as SocialOAuthCallbackController), and
// SocialAccount never stores a Facebook-scoped personal user id in the
// first place (only the connected Page's id and our own internal Admin FK
// — see MetaDataDeletionService's own comment), so there is nothing
// tenant-scoped to look up here. This row exists purely so the status URL
// Meta requires us to hand back is backed by something real to check,
// not a dead link.
@Entity({ name: 'social_data_deletion_requests' })
export class SocialDataDeletionRequest extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  platform: SocialPlatform;

  // The Facebook-scoped user id from the verified signed_request — never
  // linked to a SocialAccount/Admin row, since we don't store that
  // identifier anywhere else either.
  @Column()
  platformUserId: string;

  @Index({ unique: true })
  @Column()
  confirmationCode: string;
}
