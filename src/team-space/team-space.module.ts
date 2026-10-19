import { Module } from '@nestjs/common';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { TeamSpace } from './entity/team-space.entity';
import { TeamPost } from './entity/team-post.entity';
import { TeamPostReply } from './entity/team-post-reply.entity';
import { TeamSpaceRead } from './entity/team-space-read.entity';
import { TeamSpaceAccessService } from './service/team-space-access.service';
import { TeamSpaceService } from './service/team-space.service';
import { TeamSpaceDigestService } from './service/team-space-digest.service';
import { TeamSpaceDigestScheduler } from './scheduler/team-space-digest.scheduler';
import { TeamSpaceController } from './controller/team-space.controller';

@Module({
  imports: [
    TenantTypeOrmModule.forFeature([
      TeamSpace,
      TeamPost,
      TeamPostReply,
      TeamSpaceRead,
    ]),
  ],
  providers: [
    TeamSpaceAccessService,
    TeamSpaceService,
    TeamSpaceDigestService,
    TeamSpaceDigestScheduler,
  ],
  controllers: [TeamSpaceController],
})
export class TeamSpaceModule {}
