import { SundaySchoolAbsenteeScheduler } from './sunday-school-absentee.scheduler';

describe('SundaySchoolAbsenteeScheduler', () => {
  const classRepo = { find: jest.fn() };
  const reports = { absentees: jest.fn() };
  const churchSettings = { isEnabled: jest.fn() };
  const notifications = { notifyMember: jest.fn() };
  const scheduler = new SundaySchoolAbsenteeScheduler(
    {} as any,
    classRepo as any,
    reports as any,
    churchSettings as any,
    notifications as any,
    {} as any,
    {} as any,
    {} as any,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    churchSettings.isEnabled.mockResolvedValue(true);
    notifications.notifyMember.mockResolvedValue(undefined);
  });

  it('tells each class teacher and assistants how many members keep missing', async () => {
    reports.absentees.mockResolvedValue([
      { classId: 'c1' },
      { classId: 'c1' },
      { classId: 'c2' },
    ]);
    classRepo.find.mockResolvedValue([
      {
        id: 'c1',
        name: 'Juniors',
        teacher: { id: 't1' },
        assistants: [{ id: 'a1' }, { id: 't1' }],
      },
      { id: 'c2', name: 'Teens', teacher: null, assistants: [] },
    ]);

    await expect(scheduler.nudgeTeachers()).resolves.toBe(1);

    expect(reports.absentees).toHaveBeenCalledWith(undefined, 3);
    expect(notifications.notifyMember).toHaveBeenCalledTimes(1);
    expect(notifications.notifyMember).toHaveBeenCalledWith({
      category: 'SUNDAY_SCHOOL_ATTENDANCE',
      push: expect.objectContaining({
        memberIds: ['t1', 'a1'],
        key: 'SUNDAY_SCHOOL_ABSENTEES',
        vars: { class_name: 'Juniors', count: '2', misses: '3' },
        idempotencyKey: expect.stringMatching(/^sunday-school-absentees:c1:/),
      }),
    });
  });

  it('does nothing when Sunday School is switched off or nobody is missing', async () => {
    churchSettings.isEnabled.mockResolvedValue(false);
    await expect(scheduler.nudgeTeachers()).resolves.toBe(0);
    expect(reports.absentees).not.toHaveBeenCalled();

    churchSettings.isEnabled.mockResolvedValue(true);
    reports.absentees.mockResolvedValue([]);
    await expect(scheduler.nudgeTeachers()).resolves.toBe(0);
    expect(notifications.notifyMember).not.toHaveBeenCalled();
  });
});
