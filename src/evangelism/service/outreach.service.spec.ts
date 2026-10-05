import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { OutreachService, outreachLabel } from './outreach.service';
import { Outreach } from '../entity/outreach.entity';
import { Member } from '../../member/entity/member.entity';
import { WorkerProfile } from '../../member/entity/worker-profile.entity';
import { DateService } from '../../utility/service/date.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { CacheService } from '../../utility/service/cache.service';
import { NotificationDispatchService } from '../../utility/service/notification-dispatch.service';
import { PushNotificationKey } from '../../notification-catalogue/push-catalogue';

const mockOutreachRepo = {
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  find: jest.fn(),
  existsBy: jest.fn(),
  createQueryBuilder: jest.fn(),
};
const mockMemberRepo = { find: jest.fn() };
const mockWorkerProfileRepo = { createQueryBuilder: jest.fn() };
const mockDateService = { today: jest.fn().mockReturnValue('2026-10-05') };
const mockAuditLogService = { log: jest.fn() };
const mockCacheService = {
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(1),
  key: jest.fn().mockReturnValue('cache-key'),
  flushNamespace: jest.fn().mockResolvedValue(undefined),
};
const mockNotify = { notifyMember: jest.fn().mockResolvedValue(undefined) };

const ada = { id: 'm-1', firstname: 'Ada', lastname: 'Lovelace' };
const grace = { id: 'm-2', firstname: 'Grace', lastname: 'Hopper' };
const alan = { id: 'm-3', firstname: 'Alan', lastname: 'Turing' };

describe('OutreachService', () => {
  let service: OutreachService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OutreachService,
        { provide: getRepositoryToken(Outreach), useValue: mockOutreachRepo },
        { provide: getRepositoryToken(Member), useValue: mockMemberRepo },
        {
          provide: getRepositoryToken(WorkerProfile),
          useValue: mockWorkerProfileRepo,
        },
        { provide: DateService, useValue: mockDateService },
        { provide: AuditLogService, useValue: mockAuditLogService },
        { provide: CacheService, useValue: mockCacheService },
        { provide: NotificationDispatchService, useValue: mockNotify },
      ],
    }).compile();
    service = module.get(OutreachService);
    mockOutreachRepo.create.mockImplementation((o) => o);
    mockOutreachRepo.save.mockImplementation((o) =>
      Promise.resolve({ id: 'o-1', ...o }),
    );
  });

  describe('create', () => {
    it('puts the creator on the team, defaults the date to today and pushes the others', async () => {
      mockMemberRepo.find.mockResolvedValue([grace]);

      const result = await service.create(
        { title: ' Market ', teamMemberIds: ['m-2', 'm-2', 'm-1'] },
        ada as Member,
      );

      expect(mockOutreachRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Market',
          outreachDate: '2026-10-05',
          createdByName: 'Ada Lovelace',
          team: [ada, grace],
        }),
      );
      expect(result.team).toEqual([ada, grace]);
      expect(result.createdById).toBe('m-1');
      expect(mockNotify.notifyMember).toHaveBeenCalledWith(
        expect.objectContaining({
          push: expect.objectContaining({
            memberIds: ['m-2'],
            key: PushNotificationKey.OUTREACH_TEAM_ADDED,
            vars: {
              creator_name: 'Ada Lovelace',
              outreach_label: 'Market (2026-10-05)',
            },
          }),
        }),
      );
    });

    it('rejects team members who are not active workers', async () => {
      mockMemberRepo.find.mockResolvedValue([]);

      await expect(
        service.create({ teamMemberIds: ['m-9'] }, ada as Member),
      ).rejects.toThrow(BadRequestException);
      expect(mockOutreachRepo.save).not.toHaveBeenCalled();
    });

    it('does not push when going out alone', async () => {
      await service.create({ teamMemberIds: [] }, ada as Member);

      expect(mockMemberRepo.find).not.toHaveBeenCalled();
      expect(mockNotify.notifyMember).not.toHaveBeenCalled();
    });
  });

  describe('updateTeam', () => {
    const stored = () => ({
      id: 'o-1',
      title: null,
      outreachDate: '2026-10-01',
      createdBy: { id: 'm-1' },
      team: [ada, grace],
    });

    it('only lets team members change the team from the member app', async () => {
      mockOutreachRepo.findOne.mockResolvedValue(stored());

      await expect(
        service.updateTeam(
          'o-1',
          [],
          { memberId: 'm-9', name: 'X' },
          { asAdmin: false },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('keeps the creator, replaces the rest and pushes only new members', async () => {
      mockOutreachRepo.findOne.mockResolvedValue(stored());
      mockMemberRepo.find.mockResolvedValue([grace, alan]);
      mockOutreachRepo.save.mockImplementation((o) => Promise.resolve(o));

      const result = await service.updateTeam(
        'o-1',
        ['m-2', 'm-3'],
        { memberId: 'admin-m', name: 'Admin' },
        { asAdmin: true },
      );

      expect(result.team!.map((m) => m.id)).toEqual(['m-1', 'm-2', 'm-3']);
      expect(mockNotify.notifyMember).toHaveBeenCalledWith(
        expect.objectContaining({
          push: expect.objectContaining({
            memberIds: ['m-3'],
            vars: {
              creator_name: 'Admin',
              outreach_label: 'the outreach on 2026-10-01',
            },
          }),
        }),
      );
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'OUTREACH_TEAM_UPDATED',
        expect.objectContaining({ actorId: 'admin-m' }),
      );
    });

    it('404s for an unknown outreach', async () => {
      mockOutreachRepo.findOne.mockResolvedValue(null);

      await expect(
        service.updateTeam(
          'x',
          [],
          { memberId: 'm-1', name: 'A' },
          { asAdmin: true },
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('searchWorkers', () => {
    it('maps raw rows and excludes the caller', async () => {
      const qb: Record<string, jest.Mock> = {};
      for (const m of [
        'innerJoin',
        'leftJoin',
        'select',
        'addSelect',
        'where',
        'andWhere',
        'setParameter',
        'orderBy',
        'addOrderBy',
        'limit',
      ])
        qb[m] = jest.fn().mockReturnValue(qb);
      qb.getRawMany = jest.fn().mockResolvedValue([
        {
          memberId: 'm-2',
          workerProfileId: 'wp-2',
          firstname: 'Grace',
          lastname: 'Hopper',
          isEvangelism: true,
          openAssigned: '3',
        },
      ]);
      mockWorkerProfileRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.searchWorkers(' gra ', 'm-1');

      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('ILIKE'),
        {
          term: '%gra%',
        },
      );
      expect(qb.andWhere).toHaveBeenCalledWith('m.id != :exclude', {
        exclude: 'm-1',
      });
      expect(result).toEqual([
        expect.objectContaining({ isEvangelism: true, openAssigned: 3 }),
      ]);
    });
  });

  it('labels untitled outreaches by date', () => {
    expect(outreachLabel({ title: null, outreachDate: '2026-10-01' })).toBe(
      'the outreach on 2026-10-01',
    );
  });
});
