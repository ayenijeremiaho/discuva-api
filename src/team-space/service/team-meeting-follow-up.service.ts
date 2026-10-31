import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TeamMeeting } from '../entity/team-meeting.entity';
import { TeamMeetingAction } from '../entity/team-meeting-action.entity';
import { TeamSpace } from '../entity/team-space.entity';
import { Member } from '../../member/entity/member.entity';
import { TeamSpaceAccessService } from './team-space-access.service';
import { NotificationDispatchService } from '../../utility/service/notification-dispatch.service';
import { UtilityService } from '../../utility/service/utility.service';
import { DateService } from '../../utility/service/date.service';
import { ChurchTimezoneService } from '../../utility/service/church-timezone.service';
import { EmailCategory } from '../../utility/email-provider/email-category.enum';
import { PushNotificationKey } from '../../notification-catalogue/push-catalogue';
import { plainText } from '../util/mentions';
import { SaveMeetingActionDto } from '../dto/team-space.dto';

const NAME_SQL = `NULLIF(TRIM(COALESCE(m.firstname, '') || ' ' || COALESCE(m.lastname, '')), '')`;
const MY_ACTIONS_SHOWN = 50;

export type MeetingNotice = 'new' | 'changed' | 'cancelled';

const INVITE_WORDS: Record<MeetingNotice, (title: string) => string> = {
  new: (title) => `New meeting: ${title}`,
  changed: (title) => `Meeting updated: ${title}`,
  cancelled: (title) => `Meeting cancelled: ${title}`,
};

interface ActionRow {
  id: string;
  text: string;
  assignee_id: string | null;
  assignee_name: string | null;
  due_date: string | null;
  done_at: Date | null;
}

@Injectable()
export class TeamMeetingFollowUpService {
  constructor(
    @InjectRepository(TeamMeeting)
    private readonly meetings: Repository<TeamMeeting>,
    @InjectRepository(TeamMeetingAction)
    private readonly actions: Repository<TeamMeetingAction>,
    private readonly access: TeamSpaceAccessService,
    private readonly notifications: NotificationDispatchService,
    private readonly utility: UtilityService,
    private readonly dateService: DateService,
    private readonly churchTimezone: ChurchTimezoneService,
  ) {}

  // Each person gets their own email, so nobody sees the team's addresses.
  async sendInvite(
    meeting: {
      postId: string;
      title: string;
      startsAt: Date;
      location: string | null;
      onlineLink: string | null;
      agenda: string | null;
    },
    space: Pick<TeamSpace, 'kind' | 'refId'>,
    spaceName: string,
    notice: MeetingNotice,
    excludeId?: string | null,
  ): Promise<void> {
    const people = await this.recipients(space, excludeId);
    if (!people.length) return;
    const covered = await this.notifications.pushCovered(
      EmailCategory.TEAM_SPACES,
      people.map((p) => p.id),
    );
    const data = {
      space_name: spaceName,
      meeting_title: meeting.title,
      meeting_when: await this.when(meeting.startsAt),
      meeting_location: meeting.location ?? '',
      meeting_link: meeting.onlineLink ?? '',
      meeting_agenda: meeting.agenda ? plainText(meeting.agenda) : '',
      meeting_notice: INVITE_WORDS[notice](meeting.title),
      meeting_url: await this.utility.resolveMemberUrl(
        `/team-spaces/meeting/${meeting.postId}`,
      ),
    };
    for (const person of people) {
      if (covered.has(person.id)) continue;
      this.notifications
        .notifyMember({
          category: EmailCategory.TEAM_SPACES,
          email: {
            to: person.email,
            subject: `${spaceName}: ${data.meeting_notice}`,
            template: 'team-meeting-invite',
            data: { ...data, member_name: person.firstname ?? '' },
            recipientMemberId: person.id,
          },
        })
        .catch(() => undefined);
    }
  }

  async list(postId: string): Promise<ReturnType<typeof this.toView>[]> {
    return (await this.rows(postId)).map((row) => this.toView(row));
  }

  async create(memberId: string, postId: string, dto: SaveMeetingActionDto) {
    const { meeting, acc } = await this.leaderMeeting(memberId, postId);
    await this.assertInTeam(meeting.space, dto.assigneeId);
    const saved = await this.actions.save(
      this.actions.create({
        meeting: { postId } as TeamMeeting,
        text: dto.text.trim(),
        assignee: dto.assigneeId ? ({ id: dto.assigneeId } as Member) : null,
        dueDate: dto.dueDate ?? null,
        createdBy: { id: memberId } as Member,
      }),
    );
    if (meeting.summarySentAt && dto.assigneeId && dto.assigneeId !== memberId)
      this.pushAction(dto.assigneeId, acc.name, meeting, dto.text.trim());
    return { id: saved.id };
  }

  async update(memberId: string, actionId: string, dto: SaveMeetingActionDto) {
    const { action, meeting, acc } = await this.action(actionId);
    const member = await this.access.accessBySpace(memberId, meeting.space);
    if (!member.isLeader)
      throw new ForbiddenException('Only leaders can change actions.');
    await this.assertInTeam(meeting.space, dto.assigneeId);
    await this.actions.update(actionId, {
      text: dto.text.trim(),
      assignee: dto.assigneeId ? ({ id: dto.assigneeId } as Member) : null,
      dueDate: dto.dueDate ?? null,
    });
    if (
      meeting.summarySentAt &&
      dto.assigneeId &&
      dto.assigneeId !== memberId &&
      dto.assigneeId !== action.assignee?.id
    )
      this.pushAction(dto.assigneeId, acc.name, meeting, dto.text.trim());
    return { ok: true };
  }

  async setDone(
    memberId: string,
    actionId: string,
    done: boolean,
    now = new Date(),
  ) {
    const { action, meeting } = await this.action(actionId);
    if (action.assignee?.id !== memberId) {
      const member = await this.access.accessBySpace(memberId, meeting.space);
      if (!member.isLeader)
        throw new ForbiddenException(
          'Only the person responsible or a leader can update this.',
        );
    }
    await this.actions.update(actionId, { doneAt: done ? now : null });
    return { ok: true };
  }

  async remove(memberId: string, actionId: string) {
    const { meeting } = await this.action(actionId);
    const member = await this.access.accessBySpace(memberId, meeting.space);
    if (!member.isLeader)
      throw new ForbiddenException('Only leaders can remove actions.');
    await this.actions.delete(actionId);
    return { ok: true };
  }

  async mine(memberId: string) {
    const rows = (await this.actions.query(
      `SELECT a.id, a.text, a.due_date::text AS due_date, a.meeting_id, tm.title AS meeting_title
       FROM team_meeting_actions a
       JOIN team_meetings tm ON tm.post_id = a.meeting_id
       WHERE a.assignee_id = $1 AND a.done_at IS NULL AND tm.cancelled_at IS NULL
       ORDER BY a.due_date NULLS LAST, a.created_at
       LIMIT ${MY_ACTIONS_SHOWN}`,
      [memberId],
    )) as {
      id: string;
      text: string;
      due_date: string | null;
      meeting_id: string;
      meeting_title: string;
    }[];
    return rows.map((row) => ({
      id: row.id,
      text: row.text,
      dueDate: row.due_date,
      meeting: { postId: row.meeting_id, title: row.meeting_title },
    }));
  }

  // Sent once a leader is happy with it. Sending again is allowed, as an update.
  async sendSummary(memberId: string, postId: string, now = new Date()) {
    const { meeting, acc } = await this.leaderMeeting(memberId, postId);
    if (meeting.cancelledAt)
      throw new BadRequestException('This meeting was cancelled.');
    if (meeting.startsAt > now)
      throw new BadRequestException(
        'You can send the summary once the meeting has started.',
      );
    const rows = await this.rows(postId);
    if (!meeting.minutes?.trim() && !rows.length)
      throw new BadRequestException(
        'Add minutes or an action before sending the summary.',
      );
    const update = !!meeting.summarySentAt;
    await this.meetings.update(postId, { summarySentAt: now });
    const people = await this.recipients(meeting.space, memberId);
    const timezone = await this.churchTimezone.get();
    const due = (date: string | null) =>
      date
        ? this.dateService.format(
            new Date(`${date}T12:00:00Z`),
            'EEE d MMM',
            timezone,
          )
        : '';
    const url = await this.utility.resolveMemberUrl(
      `/team-spaces/meeting/${postId}`,
    );
    const when = await this.when(meeting.startsAt);
    const subject = `${acc.name}: ${update ? 'updated summary' : 'summary'} of ${meeting.title}`;
    for (const person of people) {
      const mine = rows.filter((row) => row.assignee_id === person.id);
      const others = rows.filter((row) => row.assignee_id !== person.id);
      this.notifications
        .notifyMember({
          category: EmailCategory.TEAM_SPACES,
          email: {
            to: person.email,
            subject,
            template: 'team-meeting-summary',
            data: {
              member_name: person.firstname ?? '',
              space_name: acc.name,
              meeting_title: meeting.title,
              meeting_when: when,
              meeting_minutes: meeting.minutes ?? '',
              my_actions: mine.map((row) => ({
                text: row.text,
                due: due(row.due_date),
              })),
              other_actions: others.map((row) => ({
                text: row.text,
                who: row.assignee_name ?? '',
                due: due(row.due_date),
              })),
              meeting_url: url,
            },
            recipientMemberId: person.id,
          },
          push: {
            memberIds: [person.id],
            key: PushNotificationKey.TEAM_SPACE_MEETING_SUMMARY,
            vars: {
              title: meeting.title,
              space_name: acc.name,
              actions: mine.length
                ? `You have ${mine.length} ${mine.length === 1 ? 'action' : 'actions'}.`
                : 'Tap to read it.',
            },
            url: `/team-spaces/meeting/${postId}`,
            idempotencyKey: `team-meeting-summary:${postId}:${person.id}:${now.getTime()}`,
          },
        })
        .catch(() => undefined);
    }
    return { sentTo: people.length };
  }

  private pushAction(
    memberId: string,
    spaceName: string,
    meeting: TeamMeeting,
    text: string,
  ) {
    this.notifications
      .notifyMember({
        category: EmailCategory.TEAM_SPACES,
        push: {
          memberIds: [memberId],
          key: PushNotificationKey.TEAM_SPACE_MEETING_ACTION,
          vars: { space_name: spaceName, title: meeting.title, text },
          url: `/team-spaces/meeting/${meeting.postId}`,
          idempotencyKey: `team-meeting-action:${meeting.postId}:${memberId}:${text}`,
        },
      })
      .catch(() => undefined);
  }

  private toView(row: ActionRow) {
    return {
      id: row.id,
      text: row.text,
      assignee: row.assignee_id
        ? { id: row.assignee_id, name: row.assignee_name ?? 'Member' }
        : null,
      dueDate: row.due_date,
      done: !!row.done_at,
    };
  }

  private rows(postId: string): Promise<ActionRow[]> {
    return this.actions.query(
      `SELECT a.id, a.text, a.assignee_id, ${NAME_SQL} AS assignee_name, a.due_date::text AS due_date, a.done_at
       FROM team_meeting_actions a LEFT JOIN members m ON m.id = a.assignee_id
       WHERE a.meeting_id = $1 ORDER BY a.created_at`,
      [postId],
    ) as Promise<ActionRow[]>;
  }

  private async recipients(
    space: Pick<TeamSpace, 'kind' | 'refId'>,
    excludeId?: string | null,
  ) {
    const ids = (await this.access.memberIds(space)).filter(
      (id) => id !== excludeId,
    );
    if (!ids.length) return [];
    return this.actions.query(
      `SELECT id, email, firstname FROM members WHERE id = ANY($1)`,
      [ids],
    ) as Promise<{ id: string; email: string; firstname: string | null }[]>;
  }

  private async assertInTeam(
    space: Pick<TeamSpace, 'kind' | 'refId'>,
    assigneeId?: string,
  ) {
    if (
      assigneeId &&
      !(await this.access.memberIds(space)).includes(assigneeId)
    )
      throw new BadRequestException('Choose someone in this team.');
  }

  private async leaderMeeting(memberId: string, postId: string) {
    const meeting = await this.meetings.findOne({
      where: { postId },
      relations: { space: true },
    });
    if (!meeting) throw new NotFoundException('Meeting not found');
    const acc = await this.access.accessBySpace(memberId, meeting.space);
    if (!acc.isLeader)
      throw new ForbiddenException('Only leaders can do this.');
    return { meeting, acc };
  }

  private async action(actionId: string) {
    const action = await this.actions.findOne({
      where: { id: actionId },
      relations: { assignee: true, meeting: { space: true } },
    });
    if (!action) throw new NotFoundException('Action not found');
    return {
      action,
      meeting: action.meeting,
      acc: { name: action.meeting.title },
    };
  }

  private async when(at: Date): Promise<string> {
    return this.dateService.format(
      at,
      "EEE d MMM 'at' h:mm a",
      await this.churchTimezone.get(),
    );
  }
}
