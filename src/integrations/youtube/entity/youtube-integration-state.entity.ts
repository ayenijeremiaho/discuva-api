import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { BaseEntity } from '../../../utility/entity/base.entity';

@Entity('youtube_integration_state')
export class YoutubeIntegrationState extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', unique: true, name: 'channel_id' })
  channelId: string;

  @Column({ type: 'varchar', nullable: true, name: 'last_announced_video_id' })
  lastAnnouncedVideoId: string | null;

  @Column({
    type: 'timestamptz',
    nullable: true,
    name: 'subscription_expires_at',
  })
  subscriptionExpiresAt: Date | null;
}
