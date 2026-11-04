import { CommunityController } from './controller/community.controller';
import { AdminCommunityController } from './controller/admin-community.controller';
import { CommunityService } from './service/community.service';
import { CommunityCategory } from './entity/community-category.entity';
import { CommunityModerator } from './entity/community-moderator.entity';
import { CommunityMute } from './entity/community-mute.entity';
import { PostReport } from './entity/post-report.entity';
import { TeamMeetingAction } from './entity/team-meeting-action.entity';
import { TeamMeetingFollowUpService } from './service/team-meeting-follow-up.service';
import { Module } from '@nestjs/common';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { TeamSpace } from './entity/team-space.entity';
import { SharedSpace } from './entity/shared-space.entity';
import { SharedSpaceService } from './service/shared-space.service';
import { SharedSpaceController } from './controller/shared-space.controller';
import { TeamPost } from './entity/team-post.entity';
import { TeamPostReply } from './entity/team-post-reply.entity';
import { TeamSpaceRead } from './entity/team-space-read.entity';
import { TeamMeeting } from './entity/team-meeting.entity';
import { TeamMeetingRsvp } from './entity/team-meeting-rsvp.entity';
import { TeamPoll } from './entity/team-poll.entity';
import { TeamPollVote } from './entity/team-poll-vote.entity';
import { TeamMeetingSeries } from './entity/team-meeting-series.entity';
import { TeamPostReaction } from './entity/team-post-reaction.entity';
import { TeamSpaceReactionService } from './service/team-space-reaction.service';
import { TeamSpaceExtrasService } from './service/team-space-extras.service';
import { TeamMeetingReminderScheduler } from './scheduler/team-meeting-reminder.scheduler';
import { TeamSpaceAccessService } from './service/team-space-access.service';
import { TeamSpaceService } from './service/team-space.service';
import { TeamSpaceDigestService } from './service/team-space-digest.service';
import { TeamSpaceDigestScheduler } from './scheduler/team-space-digest.scheduler';
import { TeamSpaceController } from './controller/team-space.controller';
import { VolunteerChatSettingsService } from './service/volunteer-chat-settings.service';
import { VolunteerChatSettingsController } from './controller/volunteer-chat-settings.controller';

@Module({
  imports: [
    TenantTypeOrmModule.forFeature([
      TeamSpace,
      SharedSpace,
      TeamPost,
      TeamPostReply,
      TeamSpaceRead,
      TeamMeeting,
      TeamMeetingAction,
      TeamMeetingRsvp,
      TeamPoll,
      TeamPollVote,
      TeamMeetingSeries,
      TeamPostReaction,
      CommunityCategory,
      CommunityModerator,
      CommunityMute,
      PostReport,
    ]),
  ],
  providers: [
    CommunityService,
    SharedSpaceService,
    TeamMeetingFollowUpService,
    TeamSpaceAccessService,
    TeamSpaceService,
    TeamSpaceDigestService,
    TeamSpaceDigestScheduler,
    TeamSpaceExtrasService,
    TeamMeetingReminderScheduler,
    VolunteerChatSettingsService,
    TeamSpaceReactionService,
  ],
  exports: [TeamSpaceAccessService],
  controllers: [
    SharedSpaceController,
    TeamSpaceController,
    VolunteerChatSettingsController,
    CommunityController,
    AdminCommunityController,
  ],
})
export class TeamSpaceModule {}
