import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { TeamSpace, TeamSpaceKindEnum } from '../entity/team-space.entity';
import { TeamPost, TeamPostTypeEnum } from '../entity/team-post.entity';
import { TeamMeeting } from '../entity/team-meeting.entity';
import { RsvpResponseEnum } from '../entity/team-meeting-rsvp.entity';
import { TeamPoll } from '../entity/team-poll.entity';
import { Member } from '../../member/entity/member.entity';
import {
  SpaceAccess,
  TeamSpaceAccessService,
} from './team-space-access.service';
import { NotificationDispatchService } from '../../utility/service/notification-dispatch.service';
import { EmailCategory } from '../../utility/email-provider/email-category.enum';
import { PushNotificationKey } from '../../notification-catalogue/push-catalogue';
import { DateService } from '../../utility/service/date.service';
import { ChurchTimezoneService } from '../../utility/service/church-timezone.service';
import {
  CreateMeetingDto,
  CreatePollDto,
  UpdateMeetingDto,
} from '../dto/team-space.dto';

export interface MeetingView {
  title: string;
  startsAt: Date;
  endsAt: Date | null;
  location: string | null;
  onlineLink: string | null;
  cancelled: boolean;
  hasMinutes: boolean;
  myResponse: RsvpResponseEnum | null;
  counts: Record<'GOING' | 'MAYBE' | 'NOT_GOING', number>;
}

export interface PollView {
  options: { id: string; text: string; votes: number }[];
  multiple: boolean;
  closesAt: Date | null;
  closed: boolean;
  voters: number;
  myVote: string[];
}

// Meetings and polls are posts with extra details; this loads those details for a whole page in two queries.
@Injectable()
export class TeamSpaceExtrasService {
  constructor(
    @InjectRepository(TeamSpace)
    private readonly spaceRepo: Repository<TeamSpace>,
    @InjectRepository(TeamPost)
    private readonly postRepo: Repository<TeamPost>,
    @InjectRepository(TeamMeeting)
    private readonly meetingRepo: Repository<TeamMeeting>,
    @InjectRepository(TeamPoll)
    private readonly pollRepo: Repository<TeamPoll>,
    private readonly access: TeamSpaceAccessService,
    private readonly notifications: NotificationDispatchService,
    private readonly dateService: DateService,
    private readonly churchTimezone: ChurchTimezoneService,
  ) {}

  async details(
    posts: { id: string; type: string }[],
    memberId: string,
    now = new Date(),
  ): Promise<{
    meetings: Map<string, MeetingView>;
    polls: Map<string, PollView>;
  }> {
    const meetingIds = posts
      .filter((p) => p.type === TeamPostTypeEnum.MEETING)
      .map((p) => p.id);
    const pollIds = posts
      .filter((p) => p.type === TeamPostTypeEnum.POLL)
      .map((p) => p.id);
    const [meetingRows, pollRows] = await Promise.all([
      meetingIds.length
        ? (this.spaceRepo.query(
            `SELECT m.post_id, m.title, m.starts_at, m.ends_at, m.location, m.online_link, m.cancelled_at,
               (m.minutes IS NOT NULL AND m.minutes <> '') AS has_minutes,
               (SELECT r.response FROM team_meeting_rsvps r WHERE r.meeting_id = m.post_id AND r.member_id = $2) AS my_response,
               (SELECT json_object_agg(x.response, x.n) FROM (
                  SELECT r.response, count(*)::int AS n FROM team_meeting_rsvps r
                  WHERE r.meeting_id = m.post_id AND r.response IS NOT NULL GROUP BY r.response) x) AS counts
             FROM team_meetings m WHERE m.post_id = ANY($1)`,
            [meetingIds, memberId],
          ) as Promise<
            {
              post_id: string;
              title: string;
              starts_at: Date;
              ends_at: Date | null;
              location: string | null;
              online_link: string | null;
              cancelled_at: Date | null;
              has_minutes: boolean;
              my_response: RsvpResponseEnum | null;
              counts: Record<string, number> | null;
            }[]
          >)
        : [],
      pollIds.length
        ? (this.spaceRepo.query(
            `SELECT p.post_id, p.options, p.multiple, p.closes_at,
               (SELECT count(*)::int FROM team_poll_votes v WHERE v.poll_id = p.post_id) AS voters,
               (SELECT v.option_ids FROM team_poll_votes v WHERE v.poll_id = p.post_id AND v.member_id = $2) AS my_vote,
               (SELECT json_object_agg(t.opt, t.n) FROM (
                  SELECT unnest(v.option_ids) AS opt, count(*)::int AS n FROM team_poll_votes v
                  WHERE v.poll_id = p.post_id GROUP BY 1) t) AS tallies
             FROM team_polls p WHERE p.post_id = ANY($1)`,
            [pollIds, memberId],
          ) as Promise<
            {
              post_id: string;
              options: { id: string; text: string }[];
              multiple: boolean;
              closes_at: Date | null;
              voters: number;
              my_vote: string[] | null;
              tallies: Record<string, number> | null;
            }[]
          >)
        : [],
    ]);
    return {
      meetings: new Map(
        meetingRows.map((m): [string, MeetingView] => [
          m.post_id,
          {
            title: m.title,
            startsAt: m.starts_at,
            endsAt: m.ends_at,
            location: m.location,
            onlineLink: m.online_link,
            cancelled: !!m.cancelled_at,
            hasMinutes: !!m.has_minutes,
            myResponse: m.my_response,
            counts: {
              GOING: m.counts?.GOING ?? 0,
              MAYBE: m.counts?.MAYBE ?? 0,
              NOT_GOING: m.counts?.NOT_GOING ?? 0,
            },
          },
        ]),
      ),
      polls: new Map(
        pollRows.map((p): [string, PollView] => [
          p.post_id,
          {
            options: p.options.map((o) => ({
              ...o,
              votes: p.tallies?.[o.id] ?? 0,
            })),
            multiple: p.multiple,
            closesAt: p.closes_at,
            closed: !!p.closes_at && new Date(p.closes_at) <= now,
            voters: p.voters,
            myVote: p.my_vote ?? [],
          },
        ]),
      ),
    };
  }

  // The space's next meetings, for the top of the space.
  async upcoming(spaceId: string, now = new Date()) {
    const rows = (await this.spaceRepo.query(
      `SELECT post_id, title, starts_at FROM team_meetings
       WHERE space_id = $1 AND cancelled_at IS NULL AND starts_at > $2
       ORDER BY starts_at LIMIT 3`,
      [spaceId, new Date(now.getTime() - 2 * 3600 * 1000)],
    )) as { post_id: string; title: string; starts_at: Date }[];
    return rows.map((r) => ({
      postId: r.post_id,
      title: r.title,
      startsAt: r.starts_at,
    }));
  }

  async createMeeting(
    memberId: string,
    kind: TeamSpaceKindEnum,
    refId: string,
    dto: CreateMeetingDto,
    now = new Date(),
  ) {
    const acc = await this.leaderAccess(memberId, kind, refId);
    const startsAt = new Date(dto.startsAt);
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : null;
    if (startsAt <= now)
      throw new BadRequestException('Pick a time in the future.');
    if (endsAt && endsAt <= startsAt)
      throw new BadRequestException('The meeting must end after it starts.');
    const post = await this.newPost(
      acc,
      memberId,
      TeamPostTypeEnum.MEETING,
      dto.agenda?.trim() || dto.title.trim(),
      now,
    );
    await this.meetingRepo.insert({
      postId: post.id,
      space: { id: acc.space.id } as TeamSpace,
      title: dto.title.trim(),
      startsAt,
      endsAt,
      location: dto.location?.trim() || null,
      onlineLink: dto.onlineLink?.trim() || null,
    });
    await this.notifyTeam(
      acc,
      memberId,
      PushNotificationKey.TEAM_SPACE_MEETING,
      {
        space_name: acc.name,
        title: dto.title.trim(),
        when: await this.when(startsAt),
      },
      post.id,
      `team-meeting:${post.id}`,
    );
    return { id: post.id };
  }

  async updateMeeting(
    memberId: string,
    postId: string,
    dto: UpdateMeetingDto,
    now = new Date(),
  ) {
    const meeting = await this.meetingRepo.findOne({
      where: { postId },
      relations: { space: true },
    });
    if (!meeting) throw new NotFoundException('Meeting not found');
    const acc = await this.access.accessBySpace(memberId, meeting.space);
    if (!acc.isLeader)
      throw new ForbiddenException('Only leaders can change meetings.');

    if (dto.cancel) {
      if (meeting.cancelledAt) return { ok: true };
      await this.meetingRepo.update(postId, { cancelledAt: now });
      await this.notifyTeam(
        acc,
        memberId,
        PushNotificationKey.TEAM_SPACE_MEETING_CHANGED,
        {
          space_name: acc.name,
          title: meeting.title,
          change: 'is cancelled',
        },
        postId,
        `team-meeting-cancel:${postId}`,
      );
      return { ok: true };
    }

    const startsAt = dto.startsAt ? new Date(dto.startsAt) : meeting.startsAt;
    const endsAt =
      dto.endsAt === undefined
        ? meeting.endsAt
        : dto.endsAt
          ? new Date(dto.endsAt)
          : null;
    if (endsAt && endsAt <= startsAt)
      throw new BadRequestException('The meeting must end after it starts.');
    const moved = startsAt.getTime() !== meeting.startsAt.getTime();
    await this.meetingRepo.update(postId, {
      title: dto.title?.trim() || meeting.title,
      startsAt,
      endsAt,
      location:
        dto.location === undefined
          ? meeting.location
          : dto.location?.trim() || null,
      onlineLink:
        dto.onlineLink === undefined
          ? meeting.onlineLink
          : dto.onlineLink?.trim() || null,
    });
    if (dto.agenda !== undefined)
      await this.postRepo.update(postId, {
        body: dto.agenda.trim() || meeting.title,
        editedAt: now,
      });
    if (moved)
      await this.notifyTeam(
        acc,
        memberId,
        PushNotificationKey.TEAM_SPACE_MEETING_CHANGED,
        {
          space_name: acc.name,
          title: dto.title?.trim() || meeting.title,
          change: `moved to ${await this.when(startsAt)}`,
        },
        postId,
        `team-meeting-move:${postId}:${startsAt.getTime()}`,
      );
    return { ok: true };
  }

  async rsvp(memberId: string, postId: string, response: RsvpResponseEnum) {
    const meeting = await this.meetingRepo.findOne({
      where: { postId },
      relations: { space: true },
    });
    if (!meeting) throw new NotFoundException('Meeting not found');
    if (meeting.cancelledAt)
      throw new BadRequestException('This meeting was cancelled.');
    await this.access.accessBySpace(memberId, meeting.space);
    await this.spaceRepo.query(
      `INSERT INTO team_meeting_rsvps (meeting_id, member_id, response) VALUES ($1, $2, $3)
       ON CONFLICT (meeting_id, member_id) DO UPDATE SET response = EXCLUDED.response, updated_at = now()`,
      [postId, memberId, response],
    );
    return { response };
  }

  // Everything about one meeting: who's coming, who hasn't said, attendance and minutes.
  async meeting(memberId: string, postId: string) {
    const meeting = await this.meetingRepo.findOne({
      where: { postId },
      relations: { space: true, minutesBy: true },
    });
    if (!meeting) throw new NotFoundException('Meeting not found');
    const acc = await this.access.accessBySpace(memberId, meeting.space);
    const roster = await this.access.memberIds(meeting.space);
    const rows = (await this.spaceRepo.query(
      `SELECT m.id, NULLIF(TRIM(COALESCE(m.firstname, '') || ' ' || COALESCE(m.lastname, '')), '') AS name,
         m.photo_url, r.response, r.attended
       FROM members m LEFT JOIN team_meeting_rsvps r ON r.member_id = m.id AND r.meeting_id = $1
       WHERE m.id IN (SELECT unnest($2::uuid[]) UNION SELECT member_id FROM team_meeting_rsvps WHERE meeting_id = $1)
       ORDER BY name`,
      [postId, roster],
    )) as {
      id: string;
      name: string | null;
      photo_url: string | null;
      response: RsvpResponseEnum | null;
      attended: boolean | null;
    }[];
    const person = (r: (typeof rows)[number]) => ({
      id: r.id,
      name: r.name ?? 'Member',
      photoUrl: r.photo_url,
    });
    const by = (resp: RsvpResponseEnum | null) =>
      rows.filter((r) => r.response === resp).map(person);
    return {
      postId,
      space: { kind: acc.kind, refId: acc.refId, name: acc.name },
      title: meeting.title,
      startsAt: meeting.startsAt,
      endsAt: meeting.endsAt,
      location: meeting.location,
      onlineLink: meeting.onlineLink,
      cancelled: !!meeting.cancelledAt,
      isLeader: acc.isLeader,
      myResponse: rows.find((r) => r.id === memberId)?.response ?? null,
      going: by(RsvpResponseEnum.GOING),
      maybe: by(RsvpResponseEnum.MAYBE),
      notGoing: by(RsvpResponseEnum.NOT_GOING),
      noReply: rows
        .filter((r) => !r.response && roster.includes(r.id))
        .map(person),
      attendanceTaken: rows.some((r) => r.attended !== null),
      attended: rows.filter((r) => r.attended).map(person),
      minutes: meeting.minutes,
      minutesUpdatedAt: meeting.minutesUpdatedAt,
      minutesBy: meeting.minutesBy
        ? `${meeting.minutesBy.firstname ?? ''} ${meeting.minutesBy.lastname ?? ''}`.trim()
        : null,
    };
  }

  async saveMinutes(
    memberId: string,
    postId: string,
    minutes: string,
    now = new Date(),
  ) {
    const meeting = await this.leaderMeeting(memberId, postId);
    await this.meetingRepo.update(meeting.postId, {
      minutes: minutes.trim() || null,
      minutesUpdatedAt: now,
      minutesBy: { id: memberId } as Member,
    });
    return { ok: true };
  }

  // Leaders tick who came; everyone else on the list is recorded as not there.
  async saveAttendance(
    memberId: string,
    postId: string,
    attendedIds: string[],
  ) {
    await this.leaderMeeting(memberId, postId);
    await this.spaceRepo.query(
      `UPDATE team_meeting_rsvps SET attended = (member_id = ANY($2)), updated_at = now() WHERE meeting_id = $1`,
      [postId, attendedIds],
    );
    if (attendedIds.length)
      await this.spaceRepo.query(
        `INSERT INTO team_meeting_rsvps (meeting_id, member_id, attended)
         SELECT $1, id, true FROM members WHERE id = ANY($2)
         ON CONFLICT (meeting_id, member_id) DO UPDATE SET attended = true, updated_at = now()`,
        [postId, attendedIds],
      );
    return { attended: attendedIds.length };
  }

  async createPoll(
    memberId: string,
    kind: TeamSpaceKindEnum,
    refId: string,
    dto: CreatePollDto,
    now = new Date(),
  ) {
    const acc = await this.leaderAccess(memberId, kind, refId);
    const texts = dto.options.map((o) => o.trim()).filter(Boolean);
    if (
      new Set(texts.map((t) => t.toLowerCase())).size !== texts.length ||
      texts.length < 2
    )
      throw new BadRequestException('Give at least two different options.');
    const closesAt = dto.closesAt ? new Date(dto.closesAt) : null;
    if (closesAt && closesAt <= now)
      throw new BadRequestException('Pick a closing time in the future.');
    const post = await this.newPost(
      acc,
      memberId,
      TeamPostTypeEnum.POLL,
      dto.question.trim(),
      now,
    );
    await this.pollRepo.insert({
      postId: post.id,
      options: texts.map((text) => ({ id: randomUUID().slice(0, 8), text })),
      multiple: !!dto.multiple,
      closesAt,
    });
    await this.notifyTeam(
      acc,
      memberId,
      PushNotificationKey.TEAM_SPACE_POLL,
      {
        space_name: acc.name,
        question: dto.question.trim(),
      },
      post.id,
      `team-poll:${post.id}`,
    );
    return { id: post.id };
  }

  async vote(
    memberId: string,
    postId: string,
    optionIds: string[],
    now = new Date(),
  ) {
    const poll = await this.pollRepo.findOne({
      where: { postId },
      relations: { post: { space: true } },
    });
    if (!poll || poll.post.removedAt)
      throw new NotFoundException('Poll not found');
    await this.access.accessBySpace(memberId, poll.post.space);
    if (poll.closesAt && poll.closesAt <= now)
      throw new BadRequestException('This poll has closed.');
    const valid = new Set(poll.options.map((o) => o.id));
    const picked = [...new Set(optionIds)];
    if (!picked.length || picked.some((id) => !valid.has(id)))
      throw new BadRequestException('Pick one of the options.');
    if (!poll.multiple && picked.length > 1)
      throw new BadRequestException('Pick just one option.');
    await this.spaceRepo.query(
      `INSERT INTO team_poll_votes (poll_id, member_id, option_ids) VALUES ($1, $2, $3)
       ON CONFLICT (poll_id, member_id) DO UPDATE SET option_ids = EXCLUDED.option_ids, updated_at = now()`,
      [postId, memberId, picked],
    );
    return { myVote: picked };
  }

  async closePoll(memberId: string, postId: string, now = new Date()) {
    const poll = await this.pollRepo.findOne({
      where: { postId },
      relations: { post: { space: true } },
    });
    if (!poll) throw new NotFoundException('Poll not found');
    const acc = await this.access.accessBySpace(memberId, poll.post.space);
    if (!acc.isLeader)
      throw new ForbiddenException('Only leaders can close polls.');
    await this.pollRepo.update(postId, { closesAt: now });
    return { ok: true };
  }

  private async leaderAccess(
    memberId: string,
    kind: TeamSpaceKindEnum,
    refId: string,
  ) {
    const acc = await this.access.access(memberId, kind, refId);
    if (!acc.isLeader)
      throw new ForbiddenException(
        'Only leaders can set up meetings and polls.',
      );
    return acc;
  }

  private async leaderMeeting(memberId: string, postId: string) {
    const meeting = await this.meetingRepo.findOne({
      where: { postId },
      relations: { space: true },
    });
    if (!meeting) throw new NotFoundException('Meeting not found');
    const acc = await this.access.accessBySpace(memberId, meeting.space);
    if (!acc.isLeader)
      throw new ForbiddenException('Only leaders can do this.');
    return meeting;
  }

  private async newPost(
    acc: SpaceAccess,
    memberId: string,
    type: TeamPostTypeEnum,
    body: string,
    now: Date,
  ) {
    const post = await this.postRepo.save(
      this.postRepo.create({
        space: { id: acc.space.id } as TeamSpace,
        author: { id: memberId } as Member,
        type,
        body,
        lastActivityAt: now,
      }),
    );
    await this.spaceRepo.update(acc.space.id, { lastActivityAt: now });
    return post;
  }

  private async when(at: Date): Promise<string> {
    const timezone = await this.churchTimezone.get();
    return this.dateService.format(at, "EEE d MMM 'at' h:mm a", timezone);
  }

  // Recipients are worked out in the request; only the send finishes on its own.
  private async notifyTeam(
    acc: SpaceAccess,
    authorId: string,
    key: PushNotificationKey,
    vars: Record<string, string>,
    postId: string,
    idempotencyKey: string,
  ) {
    const memberIds = (await this.access.memberIds(acc.space)).filter(
      (id) => id !== authorId,
    );
    if (!memberIds.length) return;
    this.notifications
      .notifyMember({
        category: EmailCategory.TEAM_SPACES,
        push: {
          memberIds,
          key,
          vars,
          url: `/team-spaces/post/${postId}`,
          idempotencyKey,
        },
      })
      .catch(() => undefined);
  }
}
