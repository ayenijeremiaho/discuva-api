import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { FirstTimerConvertService } from './first-timer-convert.service';
import { FirstTimer } from '../entity/first-timer.entity';
import { Convert } from '../../evangelism/entity/convert.entity';
import { ConvertFollowUpLog } from '../../evangelism/entity/convert-follow-up-log.entity';
import { Member } from '../../member/entity/member.entity';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { CacheService } from '../../utility/service/cache.service';
import { NotificationDispatchService } from '../../utility/service/notification-dispatch.service';
import { PushNotificationKey } from '../../notification-catalogue/push-catalogue';

const matchQb = {
  leftJoinAndSelect: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  getMany: jest.fn().mockResolvedValue([]),
};

const mockFirstTimerRepo = { findOne: jest.fn(), save: jest.fn() };
const mockConvertRepo = {
  createQueryBuilder: jest.fn().mockReturnValue(matchQb),
  findOne: jest.fn(),
  existsBy: jest.fn().mockResolvedValue(false),
  save: jest.fn((c) => Promise.resolve(c)),
  query: jest.fn().mockResolvedValue([]),
};
const mockLogRepo = {
  create: jest.fn((l) => l),
  save: jest.fn((l) => Promise.resolve(l)),
  find: jest.fn().mockResolvedValue([]),
  count: jest.fn().mockResolvedValue(0),
};
const mockMemberRepo = { findOne: jest.fn() };
const mockAuditLogService = { log: jest.fn() };
const mockCacheService = {
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(1),
  key: jest.fn().mockReturnValue('cache-key'),
  flushNamespace: jest.fn().mockResolvedValue(undefined),
};
const mockNotify = { notifyMember: jest.fn().mockResolvedValue(undefined) };

const ft = {
  id: 'ft-1',
  firstname: 'John',
  lastname: 'Smith',
  phone: '+2348012345678',
  dismissedConvertIds: [] as string[],
} as unknown as FirstTimer;

const convert = () => ({
  id: 'convert-1',
  name: 'John Smith',
  phone: '+2348012345678',
  status: 'SAVED',
  onboardedByName: 'Ada L',
  onboardedBy: { id: 'm-ada' },
  outreach: {
    id: 'o-1',
    title: 'Market',
    outreachDate: '2026-09-01',
    team: [{ id: 'm-ada' }, { id: 'm-grace' }],
  },
  assignedTo: { id: 'wp-9', member: { id: 'm-evan' } },
  firstTimer: null,
  member: null,
  lastContactedAt: null,
  createdAt: new Date('2026-09-01T10:00:00Z'),
});

describe('FirstTimerConvertService', () => {
  let service: FirstTimerConvertService;

  beforeEach(async () => {
    jest.clearAllMocks();
    matchQb.getMany.mockResolvedValue([]);
    mockConvertRepo.existsBy.mockResolvedValue(false);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FirstTimerConvertService,
        {
          provide: getRepositoryToken(FirstTimer),
          useValue: mockFirstTimerRepo,
        },
        { provide: getRepositoryToken(Convert), useValue: mockConvertRepo },
        {
          provide: getRepositoryToken(ConvertFollowUpLog),
          useValue: mockLogRepo,
        },
        { provide: getRepositoryToken(Member), useValue: mockMemberRepo },
        { provide: AuditLogService, useValue: mockAuditLogService },
        { provide: CacheService, useValue: mockCacheService },
        { provide: NotificationDispatchService, useValue: mockNotify },
      ],
    }).compile();
    service = module.get(FirstTimerConvertService);
  });

  describe('findMatches', () => {
    it('suggests unlinked converts by exact phone or by name when the convert has no phone', async () => {
      matchQb.getMany.mockResolvedValueOnce([
        convert(),
        { ...convert(), id: 'convert-2', phone: null },
      ]);

      const result = await service.findMatches(ft);

      expect(matchQb.where).toHaveBeenCalledWith('c.first_timer_id IS NULL');
      expect(matchQb.andWhere).toHaveBeenCalledWith('c.member_id IS NULL');
      expect(result.map((m) => [m.id, m.matchedOn])).toEqual([
        ['convert-1', 'phone'],
        ['convert-2', 'name'],
      ]);
    });

    it('leaves out converts Follow-Up already said are someone else', async () => {
      await service.findMatches({
        ...ft,
        dismissedConvertIds: ['convert-9'],
      } as FirstTimer);

      expect(matchQb.andWhere).toHaveBeenCalledWith(
        'c.id NOT IN (:...dismissed)',
        { dismissed: ['convert-9'] },
      );
    });
  });

  describe('link', () => {
    beforeEach(() => {
      mockFirstTimerRepo.findOne.mockResolvedValue(ft);
      mockMemberRepo.findOne.mockResolvedValue({
        id: 'm-fu',
        firstname: 'Funmi',
        lastname: 'O',
      });
    });

    it('hands the convert to Follow-Up, logs it, audits, flushes reports and tells the outreach team', async () => {
      mockConvertRepo.findOne
        .mockResolvedValueOnce(convert())
        .mockResolvedValueOnce({
          ...convert(),
          firstTimerLinkedAt: new Date(),
        });

      await service.link('ft-1', 'convert-1', 'm-fu');

      expect(mockConvertRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          firstTimer: { id: 'ft-1' },
          firstTimerLinkedAt: expect.any(Date),
          assignedTo: null,
        }),
      );
      expect(mockLogRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          loggedByName: 'Funmi O',
          note: expect.stringContaining('Follow-Up team has taken over'),
        }),
      );
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'CONVERT_LINKED_TO_FIRST_TIMER',
        expect.objectContaining({ actorId: 'm-fu', targetId: 'convert-1' }),
      );
      expect(mockCacheService.flushNamespace).toHaveBeenCalledWith(
        'evangelism:report',
      );
      expect(mockCacheService.flushNamespace).toHaveBeenCalledWith(
        'follow-up:report',
      );
      const push = mockNotify.notifyMember.mock.calls[0][0].push;
      expect(push.key).toBe(PushNotificationKey.CONVERT_VISITED_CHURCH);
      expect(push.memberIds.sort()).toEqual(['m-ada', 'm-evan', 'm-grace']);
    });

    it.each([
      ['already linked', { firstTimer: { id: 'ft-0' } }],
      ['already a member', { member: { id: 'm-x' } }],
    ])('rejects a convert that is %s', async (_label, patch) => {
      mockConvertRepo.findOne.mockResolvedValueOnce({ ...convert(), ...patch });

      await expect(service.link('ft-1', 'convert-1', 'm-fu')).rejects.toThrow(
        ConflictException,
      );
      expect(mockConvertRepo.save).not.toHaveBeenCalled();
    });

    it('turns a concurrent double-link into a 409', async () => {
      mockConvertRepo.findOne.mockResolvedValueOnce(convert());
      const raced = new QueryFailedError('UPDATE', [], new Error('dup'));
      (raced as unknown as { code: string }).code = '23505';
      mockConvertRepo.save.mockRejectedValueOnce(raced);

      await expect(service.link('ft-1', 'convert-1', 'm-fu')).rejects.toThrow(
        ConflictException,
      );
      expect(mockLogRepo.save).not.toHaveBeenCalled();
    });

    it('rejects a first-timer that already has a convert', async () => {
      mockConvertRepo.findOne.mockResolvedValueOnce(convert());
      mockConvertRepo.existsBy.mockResolvedValueOnce(true);

      await expect(service.link('ft-1', 'convert-1', 'm-fu')).rejects.toThrow(
        ConflictException,
      );
    });

    it('404s for an unknown convert', async () => {
      mockConvertRepo.findOne.mockResolvedValueOnce(null);

      await expect(service.link('ft-1', 'x', 'm-fu')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  it('dismiss remembers the convert so it stops being suggested', async () => {
    mockFirstTimerRepo.findOne.mockResolvedValueOnce({
      ...ft,
      dismissedConvertIds: ['convert-0'],
    });

    await service.dismiss('ft-1', 'convert-1');

    expect(mockFirstTimerRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        dismissedConvertIds: ['convert-0', 'convert-1'],
      }),
    );
  });

  it('unlink returns the convert to Evangelism', async () => {
    mockConvertRepo.findOne.mockResolvedValueOnce({
      ...convert(),
      firstTimer: { id: 'ft-1' },
      firstTimerLinkedAt: new Date(),
    });

    await service.unlink('ft-1', 'm-fu');

    expect(mockConvertRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ firstTimer: null, firstTimerLinkedAt: null }),
    );
    expect(mockAuditLogService.log).toHaveBeenCalledWith(
      'CONVERT_UNLINKED_FROM_FIRST_TIMER',
      expect.anything(),
    );
  });

  describe('propagateMembership', () => {
    it('marks the linked convert as joined', async () => {
      mockConvertRepo.findOne.mockResolvedValueOnce({
        ...convert(),
        member: null,
      });

      await service.propagateMembership('ft-1', 'm-new', 'admin-m');

      expect(mockConvertRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          member: { id: 'm-new' },
          linkedAt: expect.any(Date),
        }),
      );
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'CONVERT_LINKED_TO_MEMBER',
        expect.objectContaining({
          metadata: expect.objectContaining({ via: 'first_timer' }),
        }),
      );
    });

    it('leaves an already-joined convert alone', async () => {
      mockConvertRepo.findOne.mockResolvedValueOnce({
        ...convert(),
        member: { id: 'm-old' },
      });

      await service.propagateMembership('ft-1', 'm-new');

      expect(mockConvertRepo.save).not.toHaveBeenCalled();
    });
  });

  it('timeline shows the outreach and contacts before the visit, not the hand-over log', async () => {
    mockConvertRepo.findOne.mockResolvedValueOnce({
      ...convert(),
      firstTimerLinkedAt: new Date('2026-09-10T10:00:00Z'),
      outreach: {
        title: 'Market',
        team: [{ firstname: 'Ada', lastname: 'L' }],
      },
    });
    mockLogRepo.find.mockResolvedValueOnce([
      {
        contactedAt: new Date('2026-09-03T10:00:00Z'),
        loggedByName: 'Ada L',
        note: 'Called',
      },
      {
        contactedAt: new Date('2026-09-10T10:00:00Z'),
        loggedByName: 'Funmi O',
        note: 'hand-over',
      },
    ]);

    const entries = await service.timelineEntries('ft-1');

    expect(entries).toEqual([
      expect.objectContaining({
        source: 'OUTREACH_MET',
        label: 'Met on outreach: Market',
        notes: 'By Ada L',
      }),
      expect.objectContaining({
        source: 'EVANGELISM_FOLLOW_UP',
        label: 'Contacted by Ada L',
        notes: 'Called',
      }),
    ]);
  });
});
