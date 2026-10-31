import { ForbiddenException } from '@nestjs/common';
import { RotaAccessService } from './rota-access.service';
import { RotaDraftService } from './rota-draft.service';

const FUTURE = new Date('2026-11-08T08:00:00Z');
const NOW = new Date('2026-11-01T08:00:00Z');

describe('RotaDraftService', () => {
  const repo = { query: jest.fn(), delete: jest.fn(), update: jest.fn() };
  const notifications = {
    notifyMember: jest.fn().mockResolvedValue(undefined),
  };
  const audit = { log: jest.fn() };
  const rota = { applySlot: jest.fn() };
  const custom = { applySession: jest.fn() };
  let grants: { subteam: string | null; publish: boolean; roles: string[] }[];
  let isLeader: boolean;
  let draftRows: unknown[];
  let published: { member_id: string; role: string | null }[];
  const service = new RotaDraftService(
    repo as never,
    new RotaAccessService(repo as never),
    rota as never,
    custom as never,
    { get: jest.fn().mockResolvedValue('Africa/Lagos') } as never,
    { format: (d: Date) => d.toISOString().slice(0, 10) } as never,
    notifications as never,
    audit as never,
  );
  const draft = (id: string, slot: string, entries: unknown[]) => ({
    id,
    service_slot_id: slot,
    schedule_id: null,
    occurrence_date: null,
    entries,
    slot_start: FUTURE,
    slot_name: 'First Service',
  });

  beforeEach(() => {
    jest.clearAllMocks();
    grants = [];
    isLeader = true;
    draftRows = [];
    published = [];
    repo.query.mockImplementation((sql: string) => {
      if (sql.includes('AS is_leader'))
        return Promise.resolve([
          { is_leader: isLeader, is_member: true, grants },
        ]);
      if (sql.includes('LEFT JOIN service_slots ss'))
        return Promise.resolve(draftRows);
      if (sql.includes('FROM rota_assignments WHERE department_id'))
        return Promise.resolve(published);
      if (sql.includes('SELECT name FROM departments'))
        return Promise.resolve([{ name: 'Ushering' }]);
      if (sql.includes('wp.member_id = ANY'))
        return Promise.resolve([{ member_id: 'w1' }]);
      return Promise.resolve([]);
    });
  });

  it("doesn't let a drafts-only planner publish", async () => {
    isLeader = false;
    grants = [{ subteam: null, publish: false, roles: [] }];
    await expect(service.publish('p', 'd', undefined, NOW)).rejects.toThrow(
      ForbiddenException,
    );
    await expect(
      service.save('p', 'd', { slotId: 's1' }, [{ memberId: 'w1' }]),
    ).resolves.toEqual({ saved: true });
  });

  it('tells nobody when a draft is saved', async () => {
    await service.save('lead', 'd', { slotId: 's1' }, [{ memberId: 'w1' }]);
    expect(notifications.notifyMember).not.toHaveBeenCalled();
    expect(rota.applySlot).not.toHaveBeenCalled();
  });

  it('keeps others when a group planner saves their own responsibilities', async () => {
    isLeader = false;
    grants = [{ subteam: 'sub', publish: false, roles: ['Door'] }];
    published = [{ member_id: 'other', role: 'Sound' }];
    await service.save('p', 'd', { slotId: 's1' }, [
      { memberId: 'w1', role: 'Door' },
    ]);
    const insert = repo.query.mock.calls.find((c) =>
      (c[0] as string).includes('INSERT INTO rota_drafts'),
    );
    expect(JSON.parse(insert?.[1][4])).toEqual([
      { memberId: 'other', role: 'Sound' },
      { memberId: 'w1', role: 'Door' },
    ]);
  });

  it("refuses a group planner's change outside their group", async () => {
    isLeader = false;
    grants = [{ subteam: 'sub', publish: false, roles: ['Door'] }];
    await expect(
      service.save('p', 'd', { slotId: 's1' }, [
        { memberId: 'w1', role: 'Sound' },
      ]),
    ).rejects.toThrow('your own group');
  });

  it('sends one notification per person across several sessions', async () => {
    draftRows = [
      draft('a', 's1', [{ memberId: 'w1', role: 'Door' }]),
      draft('b', 's2', [{ memberId: 'w1', role: 'Door' }, { memberId: 'w2' }]),
    ];
    rota.applySlot
      .mockResolvedValueOnce({
        label: 'First',
        start: FUTURE,
        added: [{ memberId: 'w1', role: 'Door' }],
        removed: [],
      })
      .mockResolvedValueOnce({
        label: 'Second',
        start: FUTURE,
        added: [
          { memberId: 'w1', role: 'Door' },
          { memberId: 'w2', role: null },
        ],
        removed: ['w3'],
      });
    const result = await service.publish('lead', 'd', undefined, NOW);
    expect(result).toEqual({ published: 2, skipped: 0, notified: 3 });
    expect(notifications.notifyMember).toHaveBeenCalledTimes(3);
    const pushFor = (id: string) =>
      notifications.notifyMember.mock.calls
        .map((c) => c[0].push)
        .find((p) => p.memberIds[0] === id);
    expect(pushFor('w1').key).toBe('ROTA_PUBLISHED');
    expect(pushFor('w1').vars.summary).toContain("You're serving");
    expect(pushFor('w3').vars.summary).toContain('Taken off');
    expect(repo.delete).toHaveBeenCalledTimes(2);
  });

  it('skips a session that has already started', async () => {
    draftRows = [
      { ...draft('a', 's1', []), slot_start: new Date('2026-10-01T08:00:00Z') },
    ];
    const result = await service.publish('lead', 'd', undefined, NOW);
    expect(result).toEqual({ published: 0, skipped: 1, notified: 0 });
    expect(rota.applySlot).not.toHaveBeenCalled();
  });

  it("leaves another group's changes in the draft when publishing a group's own", async () => {
    isLeader = false;
    grants = [{ subteam: 'sub', publish: true, roles: ['Door'] }];
    draftRows = [
      draft('a', 's1', [
        { memberId: 'w1', role: 'Door' },
        { memberId: 'w9', role: 'Sound' },
      ]),
    ];
    rota.applySlot.mockResolvedValue({
      label: 'First',
      start: FUTURE,
      added: [{ memberId: 'w1', role: 'Door' }],
      removed: [],
    });
    await service.publish('p', 'd', undefined, NOW);
    expect(rota.applySlot.mock.calls[0][3]).toEqual([
      { memberId: 'w1', role: 'Door' },
    ]);
    expect(repo.delete).not.toHaveBeenCalled();
  });
});
