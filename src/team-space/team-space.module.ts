import { Module } from '@nestjs/common';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { TeamSpace } from './entity/team-space.entity';
import { TeamPost } from './entity/team-post.entity';
import { TeamPostReply } from './entity/team-post-reply.entity';
import { TeamSpaceRead } from './entity/team-space-read.entity';
import { TeamMeeting } from './entity/team-meeting.entity';
import { TeamMeetingRsvp } from './entity/team-meeting-rsvp.entity';
import { TeamPoll } from './entity/team-poll.entity';
import { TeamPollVote } from './entity/team-poll-vote.entity';
import { TeamMeetingSeries } from './entity/team-meeting-series.entity';
import { TeamSpaceExtrasService } from './service/team-space-extras.service';
import { TeamMeetingReminderScheduler } from './scheduler/team-meeting-reminder.scheduler';
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
      TeamMeeting,
      TeamMeetingRsvp,
      TeamPoll,
      TeamPollVote,
      TeamMeetingSeries,
    ]),
  ],
  providers: [
    TeamSpaceAccessService,
    TeamSpaceService,
    TeamSpaceDigestService,
    TeamSpaceDigestScheduler,
    TeamSpaceExtrasService,
    TeamMeetingReminderScheduler,
  ],
  exports: [TeamSpaceAccessService],
  controllers: [TeamSpaceController],
})
export class TeamSpaceModule {}
