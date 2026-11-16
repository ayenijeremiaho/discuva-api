import { mockAdminAccess } from '../../admin/testing/admin-access.mock';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  TeamSpaceAccessService,
  volunteerSpaceClosed,
} from './team-space-access.service';
import { TeamSpaceKindEnum } from '../entity/team-space.entity';

describe('TeamSpaceAccessService (volunteering)', () => {
  const now = new Date('2026-10-19T12:00:00Z');
  const day = 24 * 3600 * 1000;
  let volunteeringOn: boolean;
  const spaceRepo = {
    query: jest.fn(),
    findOne: jest.fn().mockResolvedValue({ id: 's1' }),
  };
  const churchSettings = {
    isEnabled: jest.fn((key: string) =>
      Promise.resolve(
        key === 'volunteering'
          ? volunteeringOn
          : key === 'community'
            ? false
            : true,
      ),
    ),
  };
  let chat: { openDays: number; listedDays: number };
  const chatSettings = { get: jest.fn(() => Promise.resolve(chat)) };
  const plans = { gateReason: jest.fn().mockResolvedValue(null) };
  const cls = { get: jest.fn().mockReturnValue('t1') };
  const service = new TeamSpaceAccessService(
    mockAdminAccess as never,
    spaceRepo as never,
    churchSettings as never,
    chatSettings as never,
    plans as never,
    cls as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    volunteeringOn = true;
    chat = { openDays: 3, listedDays: 14 };
  });

  it('closes a volunteering space three days after the event, or when cancelled', () => {
    const at = (offsetDays: number) =>
      new Date(now.getTime() + offsetDays * day);
    expect(volunteerSpaceClosed({ status: 'OPEN', date: at(5) }, 3, now)).toBe(
      false,
    );
    expect(
      volunteerSpaceClosed({ status: 'CLOSED', date: at(-2) }, 3, now),
    ).toBe(false);
    expect(volunteerSpaceClosed({ status: 'OPEN', date: at(-3) }, 3, now)).toBe(
      true,
    );
    expect(
      volunteerSpaceClosed({ status: 'CANCELLED', date: at(5) }, 3, now),
    ).toBe(true);
  });

  it('lists opportunities the member signed up for or leads, marking closed ones', async () => {
    spaceRepo.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'o1',
          title: 'Community clean-up',
          date: new Date(now.getTime() + 2 * day),
          status: 'OPEN',
          is_leader: false,
        },
        {
          id: 'o2',
          title: 'Food bank',
          date: new Date(now.getTime() - 5 * day),
          status: 'CLOSED',
          is_leader: true,
        },
      ]);
    const list = await service.memberships('m1', now);
    expect(list).toEqual([
      expect.objectContaining({
        kind: TeamSpaceKindEnum.VOLUNTEERING,
        refId: 'o1',
        name: 'Community clean-up',
        isLeader: false,
        closed: false,
      }),
      expect.objectContaining({ refId: 'o2', isLeader: true, closed: true }),
    ]);
    const [sql, params] = spaceRepo.query.mock.calls[3];
    expect(sql).toContain("s.status = 'CONFIRMED'");
    expect(params).toEqual([
      'm1',
      new Date(now.getTime() - 14 * day),
      new Date(now.getTime() + 30 * day),
    ]);
    expect(sql).toContain('o.date <= $3 OR EXISTS');
  });

  it('leaves volunteering out when the module is off', async () => {
    volunteeringOn = false;
    spaceRepo.query.mockResolvedValue([]);
    await service.memberships('m1', now);
    expect(spaceRepo.query).toHaveBeenCalledTimes(3);
    await expect(
      service.access('m1', TeamSpaceKindEnum.VOLUNTEERING, 'o1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("uses the church's own chat lifespan", async () => {
    chat = { openDays: 1, listedDays: 30 };
    spaceRepo.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'o1',
          title: 'Clean-up',
          date: new Date(now.getTime() - 2 * day),
          status: 'OPEN',
          is_leader: false,
        },
      ]);
    const [space] = await service.memberships('m1', now);
    expect(space).toEqual(
      expect.objectContaining({ refId: 'o1', closed: true }),
    );
    expect(spaceRepo.query.mock.calls[3][1]).toEqual([
      'm1',
      new Date(now.getTime() - 30 * day),
      new Date(now.getTime() + 30 * day),
    ]);
    expect(
      volunteerSpaceClosed(
        { status: 'OPEN', date: new Date(now.getTime() - 2 * day) },
        0,
        now,
      ),
    ).toBe(true);
    expect(
      volunteerSpaceClosed(
        { status: 'OPEN', date: new Date(now.getTime() + day) },
        0,
        now,
      ),
    ).toBe(false);
  });

  it('lets in people who signed up and leaders, but nobody else', async () => {
    const future = new Date(Date.now() + 2 * day);
    spaceRepo.query.mockResolvedValueOnce([
      {
        title: 'Community clean-up',
        date: future,
        status: 'OPEN',
        is_leader: false,
        is_member: true,
      },
    ]);
    await expect(
      service.access('m1', TeamSpaceKindEnum.VOLUNTEERING, 'o1'),
    ).resolves.toEqual(
      expect.objectContaining({
        name: 'Community clean-up',
        isLeader: false,
        closed: false,
        eventAt: future,
        space: { id: 's1' },
      }),
    );
    spaceRepo.query.mockResolvedValueOnce([
      {
        title: 'Community clean-up',
        date: future,
        status: 'OPEN',
        is_leader: false,
        is_member: false,
      },
    ]);
    await expect(
      service.access('m2', TeamSpaceKindEnum.VOLUNTEERING, 'o1'),
    ).rejects.toThrow("You're not signed up for this.");
  });

  it('reaches confirmed volunteers, the creator and department leads', async () => {
    spaceRepo.query.mockResolvedValueOnce([{ id: 'm1' }, { id: 'm2' }]);
    expect(
      await service.memberIds({
        kind: TeamSpaceKindEnum.VOLUNTEERING,
        refId: 'o1',
      }),
    ).toEqual(['m1', 'm2']);
    const sql = spaceRepo.query.mock.calls[0][0] as string;
    expect(sql).toContain('volunteer_signups');
    expect(sql).toContain('a.member_id');
    expect(sql).toContain('department_leads');
  });

  it('refuses writes to a closed space', () => {
    expect(() =>
      service.assertOpen({
        kind: TeamSpaceKindEnum.VOLUNTEERING,
        refId: 'o1',
        name: 'x',
        isLeader: true,
        closed: true,
      }),
    ).toThrow(ForbiddenException);
    expect(() =>
      service.assertOpen({
        kind: TeamSpaceKindEnum.DEPARTMENT,
        refId: 'd1',
        name: 'x',
        isLeader: false,
      }),
    ).not.toThrow();
  });
});

describe('TeamSpaceAccessService (community)', () => {
  const spaceRepo = {
    query: jest.fn(),
    findOne: jest.fn().mockResolvedValue({ id: 'community-space' }),
  };
  const enabled: Record<string, boolean> = {};
  const churchSettings = {
    isEnabled: jest.fn((key: string) => Promise.resolve(enabled[key] ?? true)),
  };
  const plans = { gateReason: jest.fn().mockResolvedValue(null) };
  const cls = { get: jest.fn().mockReturnValue('t1') };
  const service = new TeamSpaceAccessService(
    mockAdminAccess as never,
    spaceRepo as never,
    churchSettings as never,
    { get: jest.fn() } as never,
    plans as never,
    cls as never,
  );
  const ref = '00000000-0000-0000-0000-000000000000';

  beforeEach(() => {
    jest.clearAllMocks();
    for (const key of Object.keys(enabled)) delete enabled[key];
  });

  it('lets every member in and marks moderators as its leaders', async () => {
    spaceRepo.query.mockResolvedValueOnce([{ moderator: true }]);
    const acc = await service.access('m1', TeamSpaceKindEnum.COMMUNITY, ref);
    expect(acc).toMatchObject({
      kind: TeamSpaceKindEnum.COMMUNITY,
      name: 'Community',
      isLeader: true,
      space: { id: 'community-space' },
    });
  });

  it('is closed when Community is switched off, even with team spaces on', async () => {
    enabled.community = false;
    await expect(
      service.access('m1', TeamSpaceKindEnum.COMMUNITY, ref),
    ).rejects.toThrow(ForbiddenException);
  });

  it('keeps team spaces closed when only Community is on', async () => {
    enabled.team_spaces = false;
    await expect(
      service.access('m1', TeamSpaceKindEnum.DEPARTMENT, 'd1'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('refuses a plan without Community', async () => {
    plans.gateReason.mockResolvedValueOnce('NOT_ON_PLAN');
    await expect(
      service.access('m1', TeamSpaceKindEnum.COMMUNITY, ref),
    ).rejects.toThrow(ForbiddenException);
  });

  it('only knows the one Community space', async () => {
    await expect(
      service.access('m1', TeamSpaceKindEnum.COMMUNITY, 'other-id'),
    ).rejects.toThrow(NotFoundException);
  });

  it('lists Community first, and no team spaces when they are off', async () => {
    enabled.team_spaces = false;
    spaceRepo.query.mockResolvedValueOnce([{ moderator: false }]);
    expect(await service.memberships('m1')).toEqual([
      {
        kind: TeamSpaceKindEnum.COMMUNITY,
        refId: ref,
        name: 'Community',
        isLeader: false,
      },
    ]);
  });

  it('reaches every active member', async () => {
    spaceRepo.query.mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }]);
    expect(
      await service.memberIds({
        kind: TeamSpaceKindEnum.COMMUNITY,
        refId: ref,
      }),
    ).toEqual(['a', 'b']);
    expect(spaceRepo.query.mock.calls[0][0]).toContain("status = 'ACTIVE'");
  });

  it('only counts a mute that has not ended', async () => {
    spaceRepo.query.mockResolvedValueOnce([]);
    expect(await service.mutedUntil('m1')).toBeNull();
    expect(spaceRepo.query.mock.calls[0][0]).toContain('until > $2');
  });
});
