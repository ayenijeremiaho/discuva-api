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
import {
  TeamMeetingSeries,
  seriesSchedule,
} from '../entity/team-meeting-series.entity';
import { MeetingFrequencyEnum } from '../../small-group/enum/meeting-frequency.enum';
import {
  describeSchedule,
  nextMeeting,
} from '../../small-group/util/meeting-schedule';
import { localDate } from '../../event/types/slot-blueprint';
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
  MeetingRepeatEnum,
  UpdateMeetingDto,
} from '../dto/team-space.dto';

type SeriesCols = {
  s_frequency: MeetingFrequencyEnum | null;
  s_weekday: number | null;
  s_start_time: string | null;
  s_end_time: string | null;
  s_interval_weeks: number | null;
  s_week_of_month: number | null;
  s_starts_on: string | null;
  s_active: boolean | null;
};

const SERIES_SQL = `s.frequency AS s_frequency, s.weekday AS s_weekday, s.start_time AS s_start_time, s.end_time AS s_end_time,
  s.interval_weeks AS s_interval_weeks, s.week_of_month AS s_week_of_month, s.starts_on AS s_starts_on, s.active AS s_active`;

// "Every Saturday, 5:00 PM" while the series is still repeating; null otherwise.
function repeatLabel(r: SeriesCols): string | null {
  if (!r.s_active || !r.s_frequency) return null;
  return describeSchedule({
    frequency: r.s_frequency,
    weekday: r.s_weekday,
    startTime: r.s_start_time,
    endTime: r.s_end_time,
    intervalWeeks: r.s_interval_weeks ?? 1,
    weekOfMonth: r.s_week_of_month,
    startsOn: r.s_starts_on,
  });
}

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
  repeat: string | null;
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
    @InjectRepository(TeamMeetingSeries)
    private readonly seriesRepo: Repository<TeamMeetingSeries>,
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
                  WHERE r.meeting_id = m.post_id AND r.response IS NOT NULL GROUP BY r.response) x) AS counts,
               ${SERIES_SQL}
             FROM team_meetings m LEFT JOIN team_meeting_series s ON s.id = m.series_id
             WHERE m.post_id = ANY($1)`,
            [meetingIds, memberId],
          ) as Promise<
            ({
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
            } & SeriesCols)[]
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
            repeat: repeatLabel(m),
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
    const series =
      dto.repeat && dto.repeat !== MeetingRepeatEnum.NONE
        ? await this.createSeries(acc, memberId, dto, startsAt, endsAt)
        : null;
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
      series,
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

    if (dto.stopRepeating) {
      const seriesId = (
        (await this.spaceRepo.query(
          `SELECT series_id FROM team_meetings WHERE post_id = $1`,
          [postId],
        )) as { series_id: string | null }[]
      )[0]?.series_id;
      if (seriesId) await this.seriesRepo.update(seriesId, { active: false });
      return { ok: true };
    }

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
    if (dto.applyToSeries)
      await this.updateSeriesFrom(postId, dto, startsAt, endsAt);
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
      relations: { space: true, minutesBy: true, post: true },
    });
    if (!meeting) throw new NotFoundException('Meeting not found');
    const acc = await this.access.accessBySpace(memberId, meeting.space);
    const [roster, seriesRows] = await Promise.all([
      this.access.memberIds(meeting.space),
      this.spaceRepo.query(
        `SELECT ${SERIES_SQL} FROM team_meetings m JOIN team_meeting_series s ON s.id = m.series_id WHERE m.post_id = $1`,
        [postId],
      ) as Promise<SeriesCols[]>,
    ]);
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
      // The agenda is the post body, which repeats the title when none was given.
      agenda:
        meeting.post && meeting.post.body !== meeting.title
          ? meeting.post.body
          : null,
      startsAt: meeting.startsAt,
      endsAt: meeting.endsAt,
      location: meeting.location,
      onlineLink: meeting.onlineLink,
      cancelled: !!meeting.cancelledAt,
      repeat: seriesRows[0] ? repeatLabel(seriesRows[0]) : null,
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

  // Turns the first meeting's time into a schedule in church time: same weekday and time, every week, two weeks or month.
  // "This and future meetings": the series takes this meeting's new details, and its time sets the schedule from here on.
  private async updateSeriesFrom(
    postId: string,
    dto: UpdateMeetingDto,
    startsAt: Date,
    endsAt: Date | null,
  ) {
    const series = (
      (await this.spaceRepo.query(
        `SELECT s.id, s.frequency FROM team_meetings m JOIN team_meeting_series s ON s.id = m.series_id WHERE m.post_id = $1`,
        [postId],
      )) as { id: string; frequency: MeetingFrequencyEnum }[]
    )[0];
    if (!series) return;
    const timezone = await this.churchTimezone.get();
    const date = localDate(startsAt, timezone);
    const week = Math.ceil(Number(date.slice(8, 10)) / 7);
    await this.seriesRepo.update(series.id, {
      ...(dto.title?.trim() ? { title: dto.title.trim() } : {}),
      ...(dto.location !== undefined
        ? { location: dto.location?.trim() || null }
        : {}),
      ...(dto.onlineLink !== undefined
        ? { onlineLink: dto.onlineLink?.trim() || null }
        : {}),
      ...(dto.agenda !== undefined
        ? { agenda: dto.agenda.trim() || null }
        : {}),
      weekday: new Date(`${date}T00:00:00Z`).getUTCDay(),
      startTime: this.dateService.format(startsAt, 'HH:mm', timezone),
      endTime: endsAt
        ? this.dateService.format(endsAt, 'HH:mm', timezone)
        : null,
      startsOn: date,
      weekOfMonth:
        series.frequency === MeetingFrequencyEnum.MONTHLY
          ? week >= 5
            ? -1
            : week
          : null,
    });
  }

  private async createSeries(
    acc: SpaceAccess,
    memberId: string,
    dto: CreateMeetingDto,
    startsAt: Date,
    endsAt: Date | null,
  ): Promise<TeamMeetingSeries> {
    const timezone = await this.churchTimezone.get();
    const date = localDate(startsAt, timezone);
    if (dto.repeatUntil && dto.repeatUntil.slice(0, 10) < date)
      throw new BadRequestException(
        '"Repeat until" must be after the first meeting.',
      );
    const day = Number(date.slice(8, 10));
    const week = Math.ceil(day / 7);
    return this.seriesRepo.save(
      this.seriesRepo.create({
        space: { id: acc.space.id } as TeamSpace,
        title: dto.title.trim(),
        location: dto.location?.trim() || null,
        onlineLink: dto.onlineLink?.trim() || null,
        agenda: dto.agenda?.trim() || null,
        frequency:
          dto.repeat === MeetingRepeatEnum.MONTHLY
            ? MeetingFrequencyEnum.MONTHLY
            : MeetingFrequencyEnum.WEEKLY,
        weekday: new Date(`${date}T00:00:00Z`).getUTCDay(),
        startTime: this.dateService.format(startsAt, 'HH:mm', timezone),
        endTime: endsAt
          ? this.dateService.format(endsAt, 'HH:mm', timezone)
          : null,
        intervalWeeks: dto.repeat === MeetingRepeatEnum.FORTNIGHTLY ? 2 : 1,
        // A date past the 28th is the month's last such weekday.
        weekOfMonth:
          dto.repeat === MeetingRepeatEnum.MONTHLY
            ? week >= 5
              ? -1
              : week
            : null,
        startsOn: date,
        endsOn: dto.repeatUntil ? dto.repeatUntil.slice(0, 10) : null,
        createdBy: { id: memberId } as Member,
      }),
    );
  }

  // Adds the next meeting of each repeating series once its latest has started, with the same details and link.
  // Quiet on purpose: the reminders tell people. Returns when the next one is due to be added.
  async rollSeries(now = new Date()): Promise<Date | null> {
    const rows = (await this.spaceRepo.query(
      `SELECT s.id, latest.starts_at AS latest
       FROM team_meeting_series s
       CROSS JOIN LATERAL (
         SELECT m.starts_at FROM team_meetings m WHERE m.series_id = s.id ORDER BY m.starts_at DESC LIMIT 1
       ) latest
       WHERE s.active`,
    )) as { id: string; latest: Date }[];
    const later: number[] = [];
    const due = rows.filter((r) => {
      if (new Date(r.latest) > now) {
        later.push(new Date(r.latest).getTime());
        return false;
      }
      return true;
    });
    if (due.length) {
      const timezone = await this.churchTimezone.get();
      for (const row of due) {
        const series = await this.seriesRepo.findOne({
          where: { id: row.id },
          relations: { space: true, createdBy: true },
        });
        if (!series) continue;
        const at = nextMeeting(
          seriesSchedule(series),
          new Date(row.latest),
          timezone,
        );
        if (!at || (series.endsOn && localDate(at, timezone) > series.endsOn)) {
          await this.seriesRepo.update(series.id, { active: false });
          continue;
        }
        const duration =
          series.endTime && series.startTime
            ? this.minutes(series.endTime) - this.minutes(series.startTime)
            : null;
        const post = await this.postRepo.save(
          this.postRepo.create({
            space: { id: series.space.id } as TeamSpace,
            author: series.createdBy
              ? ({ id: series.createdBy.id } as Member)
              : null,
            type: TeamPostTypeEnum.MEETING,
            body: series.agenda || series.title,
            lastActivityAt: now,
          }),
        );
        await this.meetingRepo.insert({
          postId: post.id,
          space: { id: series.space.id } as TeamSpace,
          title: series.title,
          startsAt: at,
          endsAt:
            duration && duration > 0
              ? new Date(at.getTime() + duration * 60000)
              : null,
          location: series.location,
          onlineLink: series.onlineLink,
          series: { id: series.id } as TeamMeetingSeries,
        });
        await this.spaceRepo.update(series.space.id, { lastActivityAt: now });
        later.push(at.getTime());
      }
    }
    return later.length ? new Date(Math.min(...later)) : null;
  }

  private minutes(hhmm: string): number {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
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
