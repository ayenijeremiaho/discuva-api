import { formatInTimeZone } from 'date-fns-tz';
import { FellowshipReminderScheduler } from './fellowship-reminder.scheduler';
import { MeetingFrequencyEnum } from '../enum/meeting-frequency.enum';
import { MeetingFormatEnum } from '../../utility/enum/meeting-format.enum';
import { MemberStatusEnum } from '../../member/enums/member-status.enum';
import { PushNotificationKey } from '../../notification-catalogue/push-catalogue';

describe('FellowshipReminderScheduler', () => {
  const groupRepo = { find: jest.fn() };
  const memberRepo = { find: jest.fn() };
  const sent = new Map<string, unknown>();
  const cache = {
    get: jest.fn((k: string) => Promise.resolve(sent.get(k))),
    set: jest.fn((k: string, v: unknown) => {
      sent.set(k, v);
      return Promise.resolve();
    }),
  };
  const reminderSettings = { getConfig: jest.fn() };
  const churchSettings = { isEnabled: jest.fn() };
  const dispatch = { notifyMember: jest.fn() };
  const scheduler = new FellowshipReminderScheduler(
    groupRepo as never,
    memberRepo as never,
    {} as never,
    {} as never,
    cache as never,
    reminderSettings as never,
    churchSettings as never,
    { get: jest.fn().mockResolvedValue('Africa/Lagos') } as never,
    {
      format: (d: Date, p: string, tz: string) => formatInTimeZone(d, tz, p),
    } as never,
    dispatch as never,
  );

  const member = (id: string, status = MemberStatusEnum.ACTIVE) => ({
    id,
    firstname: id.toUpperCase(),
    email: `${id}@x.org`,
    status,
  });
  // Wednesdays 6–8 PM Lagos (17:00–19:00 UTC).
  const group = {
    id: 'g1',
    name: 'Lekki Fellowship',
    meetingFrequency: MeetingFrequencyEnum.WEEKLY,
    meetingWeekday: 3,
    meetingStartTime: '18:00',
    meetingEndTime: '20:00',
    meetingIntervalWeeks: 1,
    meetingWeekOfMonth: null,
    meetingStartsOn: null,
    meetingNotes: 'Bring a friend',
    meetingFormat: MeetingFormatEnum.IN_PERSON,
    meetingLocation: '12 Admiralty Way',
    meetingLink: null,
    venue: null,
    leader: member('lead'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    sent.clear();
    churchSettings.isEnabled.mockResolvedValue(true);
    reminderSettings.getConfig.mockResolvedValue({
      enabled: true,
      thresholds: [24, 3],
    });
    groupRepo.find.mockResolvedValue([group]);
    memberRepo.find.mockResolvedValue([
      { group: { id: 'g1' }, member: member('ada') },
      {
        group: { id: 'g1' },
        member: member('gone', MemberStatusEnum.INACTIVE),
      },
      { group: { id: 'g1' }, member: member('lead') },
    ]);
  });

  it('reminds active members and the leader once, three hours before', async () => {
    // Wed 21 Oct, 3 PM Lagos.
    const now = new Date('2026-10-21T14:00:00Z');
    await scheduler.runReminders(now);
    await scheduler.runReminders(now);

    const ids = dispatch.notifyMember.mock.calls.map(
      (c) => c[0].push.memberIds[0],
    );
    expect(ids.sort()).toEqual(['ada', 'lead']);
    expect(dispatch.notifyMember).toHaveBeenCalledWith(
      expect.objectContaining({
        email: expect.objectContaining({
          to: 'ada@x.org',
          subject: 'Lekki Fellowship meets today',
          template: 'fellowship-meeting-reminder',
          data: expect.objectContaining({
            meetingDate: 'Wed 21 Oct',
            meetingTime: '6:00 PM–8:00 PM',
            place: '12 Admiralty Way',
            notes: 'Bring a friend',
          }),
        }),
        push: expect.objectContaining({
          key: PushNotificationKey.FELLOWSHIP_MEETING_REMINDER,
          vars: {
            group_name: 'Lekki Fellowship',
            when: 'today',
            time: '6:00 PM–8:00 PM',
            place: ' · 12 Admiralty Way',
          },
          url: '/small-groups/g1',
        }),
      }),
    );
  });

  it('sends the 24-hour reminder too, without one blocking the other', async () => {
    await scheduler.runReminders(new Date('2026-10-20T17:00:00Z'));
    await scheduler.runReminders(new Date('2026-10-21T14:00:00Z'));
    const keys = dispatch.notifyMember.mock.calls.map(
      (c) => c[0].push.idempotencyKey,
    );
    expect(new Set(keys).size).toBe(4);
    expect(dispatch.notifyMember.mock.calls[0][0].email.subject).toBe(
      'Lekki Fellowship meets tomorrow',
    );
  });

  it('sends nothing when reminders or the Fellowships module are off', async () => {
    const now = new Date('2026-10-21T14:00:00Z');
    reminderSettings.getConfig.mockResolvedValueOnce({
      enabled: false,
      thresholds: [3],
    });
    await expect(scheduler.runReminders(now)).resolves.toBeNull();
    churchSettings.isEnabled.mockResolvedValueOnce(false);
    await expect(scheduler.runReminders(now)).resolves.toBeNull();
    expect(dispatch.notifyMember).not.toHaveBeenCalled();
  });

  it('links online meetings straight to the meeting', async () => {
    groupRepo.find.mockResolvedValue([
      {
        ...group,
        meetingFormat: MeetingFormatEnum.ONLINE,
        meetingLink: 'https://meet.example.org/lekki',
      },
    ]);
    await scheduler.runReminders(new Date('2026-10-21T14:00:00Z'));
    const call = dispatch.notifyMember.mock.calls[0][0];
    expect(call.email.data).toEqual(
      expect.objectContaining({
        place: 'Online',
        meetingLink: 'https://meet.example.org/lekki',
      }),
    );
  });

  it('wakes for the next reminder due, not every hour', () => {
    const at = new Date('2026-10-21T17:00:00Z');
    expect(
      FellowshipReminderScheduler.nextDue(
        [at],
        [3],
        new Date('2026-10-20T09:00:00Z'),
      ),
    ).toEqual(new Date('2026-10-21T13:30:01Z'));
  });
});
