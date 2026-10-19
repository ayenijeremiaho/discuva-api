import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { ServingRotaService, serviceName } from './serving-rota.service';

describe('ServingRotaService', () => {
  const now = new Date('2026-10-19T08:00:00Z');
  const future = new Date('2026-10-25T07:00:00Z');
  let role: { is_leader: boolean; is_member: boolean };
  let existing: { id: string; member_id: string; role: string | null }[];
  let eligible: string[];
  let lockedRequest: { id: string; status: string } | null;
  let acceptDetails: Record<string, unknown>;
  let alreadyOnRota: unknown[];
  const slot = {
    slot_id: 's1',
    name: 'First Service',
    event_name: 'Sunday Service',
    start_time: future,
    end_time: future,
    venue: 'Main',
  };

  // Answers each raw query by what it asks for.
  const query = jest.fn((sql: string, _params?: unknown[]) => {
    if (
      sql.includes('AS is_leader') &&
      sql.includes('AS is_member') &&
      !sql.includes('FROM departments')
    )
      return Promise.resolve([role]);
    if (
      sql.includes('FROM service_slots ss') &&
      sql.includes('WHERE ss.id = $1')
    )
      return Promise.resolve([slot]);
    if (sql.includes('wp.member_id = ANY($2)'))
      return Promise.resolve(eligible.map((member_id) => ({ member_id })));
    if (sql.startsWith('SELECT id, member_id, role FROM rota_assignments'))
      return Promise.resolve(existing);
    if (sql.includes('SELECT name FROM departments'))
      return Promise.resolve([{ name: 'Ushering' }]);
    if (
      sql.includes('FROM rota_assignments a\n') &&
      sql.includes('WHERE a.id = $1')
    )
      return Promise.resolve([
        {
          id: 'a1',
          member_id: 'm1',
          department_id: 'd1',
          role: 'Main door',
          slot_id: 's1',
          name: 'First Service',
          start_time: future,
          event_name: 'Sunday Service',
          member_name: 'Ada Obi',
        },
      ]);
    if (sql.includes('AND wp.member_id <> $2'))
      return Promise.resolve([{ member_id: 'm2' }, { member_id: 'm3' }]);
    if (
      sql.includes(
        'FROM worker_profiles wp JOIN members m ON m.id = wp.member_id\n       WHERE wp.member_id = $1',
      )
    )
      return Promise.resolve([{}]);
    return Promise.resolve([]);
  });
  const assignmentRepo = { query, update: jest.fn() };
  const coverRepo = {
    exists: jest.fn().mockResolvedValue(false),
    save: jest.fn((c) => Promise.resolve({ id: 'c-new', ...c })),
    create: jest.fn((c) => c),
    findOne: jest.fn(),
    update: jest.fn(),
  };
  const txQuery = jest.fn((sql: string, _params?: unknown[]) => {
    if (sql.includes('JOIN members me ON me.id = $2'))
      return Promise.resolve([acceptDetails]);
    if (sql.startsWith('SELECT 1 FROM rota_assignments WHERE service_slot_id'))
      return Promise.resolve(alreadyOnRota);
    if (sql.includes('FROM department_leads l'))
      return Promise.resolve([{ member_id: 'lead1' }]);
    return Promise.resolve([]);
  });
  const lockQb = {
    where: jest.fn().mockReturnThis(),
    setLock: jest.fn().mockReturnThis(),
    getOne: jest.fn(() => Promise.resolve(lockedRequest)),
  };
  const txHost = {
    tx: {
      query: txQuery,
      getRepository: () => ({ createQueryBuilder: () => lockQb }),
    },
  };
  const notifications = {
    notifyMember: jest.fn().mockResolvedValue(undefined),
  };
  const audit = { log: jest.fn() };
  const service = new ServingRotaService(
    assignmentRepo as never,
    coverRepo as never,
    txHost as never,
    notifications as never,
    audit as never,
    { format: () => 'Sun 25 Oct, 8:00 AM' } as never,
    { get: jest.fn().mockResolvedValue('Africa/Lagos') } as never,
  );
  const pushes = () =>
    notifications.notifyMember.mock.calls.map((c) => c[0].push);

  beforeEach(() => {
    jest.clearAllMocks();
    role = { is_leader: true, is_member: true };
    existing = [];
    eligible = [];
    lockedRequest = { id: 'c1', status: 'OPEN' };
    alreadyOnRota = [];
    acceptDetails = {
      assignment_id: 'a1',
      department_id: 'd1',
      requested_by_id: 'm1',
      target_member_id: null,
      role: 'Main door',
      slot_id: 's1',
      name: 'First Service',
      start_time: future,
      event_name: 'Sunday Service',
      department_name: 'Ushering',
      volunteer: 'Grace Eze',
    };
  });

  it('names a service with its event', () => {
    expect(
      serviceName({ name: 'First Service', event_name: 'Sunday Service' }),
    ).toBe('Sunday Service · First Service');
    expect(serviceName({ name: 'Vigil', event_name: 'Vigil' })).toBe('Vigil');
  });

  describe('saving a rota', () => {
    it('is for leaders only', async () => {
      role = { is_leader: false, is_member: true };
      await expect(
        service.saveSlotRota('m1', 'd1', 's1', [], now),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('only takes workers from the department', async () => {
      eligible = ['w1'];
      await expect(
        service.saveSlotRota(
          'lead',
          'd1',
          's1',
          [{ memberId: 'w1' }, { memberId: 'outsider' }],
          now,
        ),
      ).rejects.toThrow(
        'Only active workers in this department can be on its rota.',
      );
    });

    it('adds, removes and renames, and tells only the people affected', async () => {
      existing = [
        { id: 'a-keep', member_id: 'w1', role: 'Door' },
        { id: 'a-gone', member_id: 'w2', role: null },
      ];
      eligible = ['w1', 'w3', 'w4'];
      await service.saveSlotRota(
        'lead',
        'd1',
        's1',
        [
          { memberId: 'w1', role: 'Main door' },
          { memberId: 'w3', role: 'Car park' },
          { memberId: 'w4', role: 'Car park' },
        ],
        now,
      );
      expect(query).toHaveBeenCalledWith(
        'DELETE FROM rota_assignments WHERE id = ANY($1)',
        [['a-gone']],
      );
      const insert = query.mock.calls.find((c) =>
        (c[0] as string).startsWith('INSERT INTO rota_assignments'),
      );
      expect(insert?.[1]).toEqual([
        'd1',
        's1',
        ['w3', 'w4'],
        ['Car park', 'Car park'],
        'lead',
      ]);
      expect(assignmentRepo.update).toHaveBeenCalledWith('a-keep', {
        role: 'Main door',
      });
      const [added, removed] = pushes();
      expect(added.memberIds).toEqual(['w3', 'w4']);
      expect(added.vars.role).toBe(' · Car park');
      expect(removed.memberIds).toEqual(['w2']);
      expect(audit.log).toHaveBeenCalledWith(
        'ROTA_UPDATED',
        expect.objectContaining({
          metadata: expect.objectContaining({
            added: 2,
            removed: 1,
            changed: 1,
          }),
        }),
      );
    });
  });

  describe('cover', () => {
    it('asks the whole department except people already serving', async () => {
      const result = await service.requestCover(
        'm1',
        'a1',
        { reason: 'Travelling' },
        now,
      );
      expect(result).toEqual({ id: 'c-new', notified: 2 });
      expect(pushes()[0].vars).toEqual({
        requester: 'Ada Obi',
        service_name: 'Sunday Service · First Service',
        when: 'Sun 25 Oct, 8:00 AM',
        role: ' · Main door',
      });
    });

    it('only lets you ask for your own duty, once', async () => {
      await expect(
        service.requestCover('m9', 'a1', {}, now),
      ).rejects.toBeInstanceOf(ForbiddenException);
      coverRepo.exists.mockResolvedValueOnce(true);
      await expect(
        service.requestCover('m1', 'a1', {}, now),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('hands the duty over to the first teammate who accepts, and tells the asker and leads', async () => {
      await service.acceptCover('m2', 'c1', now);
      expect(txQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE rota_assignments SET member_id = $2'),
        ['a1', 'm2'],
      );
      expect(txQuery).toHaveBeenCalledWith(
        expect.stringContaining("SET status = 'ACCEPTED'"),
        ['c1', 'm2', now],
      );
      expect(pushes()[0].memberIds).toEqual(['m1', 'lead1']);
      expect(audit.log).toHaveBeenCalledWith(
        'ROTA_COVER_ACCEPTED',
        expect.anything(),
      );
    });

    it('turns away a second taker, the asker, someone not chosen, and someone already serving', async () => {
      lockedRequest = { id: 'c1', status: 'ACCEPTED' };
      await expect(service.acceptCover('m2', 'c1', now)).rejects.toThrow(
        'Someone has already covered this',
      );
      lockedRequest = { id: 'c1', status: 'OPEN' };
      await expect(service.acceptCover('m1', 'c1', now)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      acceptDetails.target_member_id = 'm5';
      await expect(service.acceptCover('m2', 'c1', now)).rejects.toThrow(
        'This request was sent to someone else.',
      );
      acceptDetails.target_member_id = null;
      alreadyOnRota = [{}];
      await expect(service.acceptCover('m2', 'c1', now)).rejects.toThrow(
        "You're already on the rota for this service.",
      );
    });
  });
});
