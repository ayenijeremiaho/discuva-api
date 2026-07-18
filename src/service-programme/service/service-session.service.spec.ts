import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import {
  ServiceSessionService,
  SessionAnchor,
} from './service-session.service';
import { ServiceProgrammeService } from './service-programme.service';
import { ServiceSession } from '../entity/service-session.entity';
import { ServiceSessionSlot } from '../entity/service-session-slot.entity';
import { ServicePauseEntry } from '../entity/service-pause-entry.entity';
import { ServiceActionEntry } from '../entity/service-action-entry.entity';
import { ServiceSessionAccessGrant } from '../entity/service-session-access-grant.entity';
import { WorkerProfile } from '../../member/entity/worker-profile.entity';
import { Member } from '../../member/entity/member.entity';
import { Admin } from '../../admin/entity/admin.entity';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { ServiceSessionStatusEnum } from '../enum/service-session-status.enum';
import { ServiceSessionSlotStatusEnum } from '../enum/service-session-slot-status.enum';
import { ServicePauseReasonEnum } from '../enum/service-pause-reason.enum';
import { ServiceProgrammeStatusEnum } from '../enum/service-programme-status.enum';
import { ServiceSlotTypeEnum } from '../enum/service-slot-type.enum';
import { ServiceActionRoleEnum } from '../enum/service-action-role.enum';
import { DepartmentKeyEnum } from '../../department/enums/department-key.enum';
import { CacheService } from '../../utility/service/cache.service';
import { EmailQueueService } from '../../utility/service/email-queue.service';
import { PdfService } from '../../utility/service/pdf.service';
import { UtilityService } from '../../utility/service/utility.service';

const mockCacheService = {
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(1),
  key: jest.fn().mockReturnValue('cache-key'),
  getOrSet: jest
    .fn()
    .mockImplementation((_key: string, fn: () => Promise<unknown>) => fn()),
  flushNamespace: jest.fn().mockResolvedValue(undefined),
};

const mockConfigService = {
  get: jest.fn((_key: string, defaultValue?: unknown) => defaultValue),
};

const mockProgrammeSvc = {
  assertProgrammeIsDraft: jest.fn(),
  setProgrammeStatus: jest.fn(),
  upsertTemplateFromProgramme: jest.fn(),
  findStartableDraftProgrammesForEvent: jest.fn(),
};

const mockSessionRepo = {
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  find: jest.fn(),
  update: jest.fn(),
  createQueryBuilder: jest.fn(),
};

const mockSessionSlotRepo = {
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  find: jest.fn(),
  count: jest.fn(),
  update: jest.fn(),
  createQueryBuilder: jest.fn(),
};

const mockPauseEntryRepo = {
  create: jest.fn(),
  save: jest.fn(),
  createQueryBuilder: jest.fn(),
};

const mockActionEntryRepo = {
  create: jest.fn(),
  save: jest.fn(),
  find: jest.fn(),
};

const mockAccessGrantRepo = {
  create: jest.fn(),
  save: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
  update: jest.fn(),
};

const mockWorkerProfileRepo = {
  findOne: jest.fn(),
  createQueryBuilder: jest.fn(),
};

const mockEmailQueueService = {
  queueEmailWithTemplate: jest.fn().mockResolvedValue('job-1'),
  queueEmailWithTemplateAndAttachments: jest.fn().mockResolvedValue('job-2'),
};

const mockPdfService = {
  generateSessionReport: jest.fn().mockResolvedValue(Buffer.from('pdf')),
  generateFullEventReport: jest.fn().mockResolvedValue(Buffer.from('pdf')),
};

const mockMemberRepo = {
  findOne: jest.fn(),
};

const mockAdminRepo = {
  findOne: jest.fn(),
};

const qbMock = {
  update: jest.fn().mockReturnThis(),
  set: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  execute: jest.fn().mockResolvedValue(undefined),
};

const mockDataSource = {
  transaction: jest.fn(),
};

const adminDeptProfile = {
  id: 'wp-1',
  department: { id: 'dept-1', key: DepartmentKeyEnum.ADMIN },
  secondaryDepartment: null,
};

const nonAdminProfile = {
  id: 'wp-2',
  department: { id: 'dept-2', key: DepartmentKeyEnum.WORSHIP },
  secondaryDepartment: null,
};

const validAdmin = {
  isActive: true,
  adminRole: { permissions: [AdminPermission.SERVICE_PROGRAMME_WRITE] },
};

const mockMember = { id: 'member-1', firstname: 'Ada' };

const draftProgramme = {
  id: 'prog-1',
  status: ServiceProgrammeStatusEnum.DRAFT,
  saveAsTemplate: false,
  serviceSlot: { name: 'First Service' },
  slots: [
    {
      id: 'ps-0',
      position: 0,
      type: ServiceSlotTypeEnum.SPEAKER,
      allocatedMinutes: 30,
    },
    {
      id: 'ps-1',
      position: 1,
      type: ServiceSlotTypeEnum.BREAK,
      allocatedMinutes: 10,
    },
  ],
};

const liveAnchor: SessionAnchor = {
  currentSlotPosition: 0,
  slotStartedAt: Date.now() - 60_000,
  slotBaseSeconds: 0,
  status: ServiceSessionStatusEnum.LIVE,
  isPaused: false,
  pausedAt: null,
};

const pausedAnchor: SessionAnchor = {
  ...liveAnchor,
  isPaused: true,
  pausedAt: Date.now() - 30_000,
};

const mockSession = {
  id: 'sess-1',
  sessionCode: 'SVC-ABC123',
  status: ServiceSessionStatusEnum.LIVE,
  programme: draftProgramme,
};

describe('ServiceSessionService', () => {
  let service: ServiceSessionService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPauseEntryRepo.createQueryBuilder.mockReturnValue(qbMock);
    mockSessionSlotRepo.createQueryBuilder.mockReturnValue(qbMock);
    mockWorkerProfileRepo.createQueryBuilder.mockReturnValue({
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    });
    mockActionEntryRepo.create.mockReturnValue({});
    mockActionEntryRepo.save.mockResolvedValue({});
    mockMemberRepo.findOne.mockResolvedValue(mockMember);
    mockAdminRepo.findOne.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServiceSessionService,
        { provide: DataSource, useValue: mockDataSource },
        { provide: CacheService, useValue: mockCacheService },
        { provide: ServiceProgrammeService, useValue: mockProgrammeSvc },
        { provide: EmailQueueService, useValue: mockEmailQueueService },
        { provide: PdfService, useValue: mockPdfService },
        {
          provide: getRepositoryToken(ServiceSession),
          useValue: mockSessionRepo,
        },
        {
          provide: getRepositoryToken(ServiceSessionSlot),
          useValue: mockSessionSlotRepo,
        },
        {
          provide: getRepositoryToken(ServicePauseEntry),
          useValue: mockPauseEntryRepo,
        },
        {
          provide: getRepositoryToken(ServiceActionEntry),
          useValue: mockActionEntryRepo,
        },
        {
          provide: getRepositoryToken(ServiceSessionAccessGrant),
          useValue: mockAccessGrantRepo,
        },
        {
          provide: getRepositoryToken(WorkerProfile),
          useValue: mockWorkerProfileRepo,
        },
        { provide: getRepositoryToken(Member), useValue: mockMemberRepo },
        { provide: getRepositoryToken(Admin), useValue: mockAdminRepo },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<ServiceSessionService>(ServiceSessionService);
  });

  // ── assertCanControlSession ───────────────────────────────────────────────

  describe('access control', () => {
    it('throws ForbiddenException when caller is not an admin at all', async () => {
      mockWorkerProfileRepo.findOne.mockResolvedValue(null);
      mockAdminRepo.findOne.mockResolvedValue(null);
      await expect(service.advance('SVC-ABC123', 'member-x')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws ForbiddenException when admin lacks SERVICE_PROGRAMME_WRITE permission', async () => {
      mockAdminRepo.findOne.mockResolvedValue({
        isActive: true,
        adminRole: { permissions: [AdminPermission.SERVICE_PROGRAMME_READ] },
      });
      await expect(service.advance('SVC-ABC123', 'admin-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws ForbiddenException for an Admin-department worker — department-based control access was removed', async () => {
      mockWorkerProfileRepo.findOne.mockResolvedValue(adminDeptProfile);
      mockAdminRepo.findOne.mockResolvedValue(null);
      await expect(service.advance('SVC-ABC123', 'member-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws ForbiddenException even when secondary department key is ADMIN', async () => {
      mockWorkerProfileRepo.findOne.mockResolvedValue({
        ...nonAdminProfile,
        secondaryDepartment: { key: DepartmentKeyEnum.ADMIN },
      });
      mockAdminRepo.findOne.mockResolvedValue(null);
      await expect(service.advance('SVC-ABC123', 'member-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('allows access when caller is an admin with SERVICE_PROGRAMME_WRITE permission', async () => {
      mockAdminRepo.findOne.mockResolvedValue(validAdmin);
      mockCacheService.get.mockResolvedValue(liveAnchor);
      mockSessionRepo.findOne.mockResolvedValue(mockSession);
      mockSessionSlotRepo.count.mockResolvedValue(2);
      mockSessionSlotRepo.update.mockResolvedValue(undefined);

      await expect(
        service.advance('SVC-ABC123', 'admin-1'),
      ).resolves.not.toThrow();
    });
  });

  // ── start ─────────────────────────────────────────────────────────────────

  describe('start', () => {
    beforeEach(() => {
      mockAdminRepo.findOne.mockResolvedValue(validAdmin);
      mockProgrammeSvc.assertProgrammeIsDraft.mockResolvedValue(draftProgramme);
      mockProgrammeSvc.setProgrammeStatus.mockResolvedValue(undefined);
    });

    it('creates session and writes Redis anchor', async () => {
      const savedSession = { ...mockSession };
      mockDataSource.transaction.mockImplementation(async (cb) => {
        mockSessionRepo.create.mockReturnValue(savedSession);
        mockSessionRepo.save.mockResolvedValue(savedSession);
        mockSessionSlotRepo.create.mockReturnValue({});
        mockSessionSlotRepo.save.mockResolvedValue([]);
        return cb({
          create: (Entity, data) => mockSessionRepo.create(data),
          save: (Entity, data) => mockSessionRepo.save(data),
        });
      });

      await service.start('prog-1', 'member-1');
      expect(mockCacheService.set).toHaveBeenCalledWith(
        'cache-key',
        expect.objectContaining({
          currentSlotPosition: 0,
          slotBaseSeconds: 0,
          isPaused: false,
          status: ServiceSessionStatusEnum.LIVE,
        }),
        expect.any(Number),
      );
      expect(mockProgrammeSvc.setProgrammeStatus).toHaveBeenCalledWith(
        'prog-1',
        ServiceProgrammeStatusEnum.LIVE,
      );
    });

    it('throws BadRequestException when programme has no slots', async () => {
      mockProgrammeSvc.assertProgrammeIsDraft.mockResolvedValue({
        ...draftProgramme,
        slots: [],
      });
      await expect(service.start('prog-1', 'member-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('also generates and stores a share token', async () => {
      mockDataSource.transaction.mockImplementation(async (cb) => {
        mockSessionRepo.create.mockReturnValue(mockSession);
        mockSessionRepo.save.mockResolvedValue(mockSession);
        mockSessionSlotRepo.create.mockReturnValue({});
        mockSessionSlotRepo.save.mockResolvedValue([]);
        return cb({
          create: (Entity, data) => mockSessionRepo.create(data),
          save: (Entity, data) => mockSessionRepo.save(data),
        });
      });

      await service.start('prog-1', 'member-1');
      expect(mockCacheService.set).toHaveBeenCalledWith(
        'cache-key',
        expect.any(String),
        expect.any(Number),
      );
    });
  });

  // ── startEvent ────────────────────────────────────────────────────────────

  describe('startEvent', () => {
    beforeEach(() => {
      mockAdminRepo.findOne.mockResolvedValue(validAdmin);
      mockProgrammeSvc.setProgrammeStatus.mockResolvedValue(undefined);
      mockDataSource.transaction.mockImplementation(async (cb) => {
        mockSessionRepo.create.mockReturnValue(mockSession);
        mockSessionRepo.save.mockResolvedValue(mockSession);
        mockSessionSlotRepo.create.mockReturnValue({});
        mockSessionSlotRepo.save.mockResolvedValue([]);
        return cb({
          create: (Entity: unknown, data: unknown) =>
            mockSessionRepo.create(data),
          save: (Entity: unknown, data: unknown) => mockSessionRepo.save(data),
        });
      });
    });

    it('starts every startable draft programme under the event', async () => {
      mockProgrammeSvc.findStartableDraftProgrammesForEvent.mockResolvedValue([
        { ...draftProgramme, id: 'prog-1' },
        { ...draftProgramme, id: 'prog-2' },
      ]);

      const sessions = await service.startEvent('event-1', 'member-1');

      expect(sessions).toHaveLength(2);
      expect(
        mockProgrammeSvc.findStartableDraftProgrammesForEvent,
      ).toHaveBeenCalledWith('event-1');
      expect(mockProgrammeSvc.setProgrammeStatus).toHaveBeenCalledWith(
        'prog-1',
        ServiceProgrammeStatusEnum.LIVE,
      );
      expect(mockProgrammeSvc.setProgrammeStatus).toHaveBeenCalledWith(
        'prog-2',
        ServiceProgrammeStatusEnum.LIVE,
      );
    });

    it('throws BadRequestException when the event has no startable draft programmes', async () => {
      mockProgrammeSvc.findStartableDraftProgrammesForEvent.mockResolvedValue(
        [],
      );
      await expect(service.startEvent('event-1', 'member-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ── getShareLinks / verifyShareToken ─────────────────────────────────────

  describe('getShareLinks', () => {
    it('returns the sessionCode and stored share token', async () => {
      mockAdminRepo.findOne.mockResolvedValue(validAdmin);
      mockCacheService.get
        .mockResolvedValueOnce(liveAnchor)
        .mockResolvedValueOnce('token-abc');

      const result = await service.getShareLinks('SVC-ABC123', 'member-1');
      expect(result).toEqual({
        sessionCode: 'SVC-ABC123',
        shareToken: 'token-abc',
      });
    });

    it('throws NotFoundException when the session itself is not live', async () => {
      mockAdminRepo.findOne.mockResolvedValue(validAdmin);
      mockCacheService.get.mockResolvedValueOnce(undefined);

      await expect(
        service.getShareLinks('SVC-ABC123', 'member-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('self-heals by generating and storing a new token when the session is live but no token was ever written', async () => {
      mockAdminRepo.findOne.mockResolvedValue(validAdmin);
      mockCacheService.get
        .mockResolvedValueOnce(liveAnchor)
        .mockResolvedValueOnce(undefined);

      const result = await service.getShareLinks('SVC-ABC123', 'member-1');
      expect(result.sessionCode).toBe('SVC-ABC123');
      expect(result.shareToken).toEqual(expect.any(String));
      expect(mockCacheService.set).toHaveBeenCalledWith(
        'cache-key',
        result.shareToken,
        expect.any(Number),
      );
    });
  });

  describe('rotateShareToken', () => {
    it('generates and stores a new token, and logs the action', async () => {
      mockAdminRepo.findOne.mockResolvedValue(validAdmin);
      mockSessionRepo.findOne.mockResolvedValue(mockSession);

      const result = await service.rotateShareToken('SVC-ABC123', 'member-1');
      expect(result.sessionCode).toBe('SVC-ABC123');
      expect(result.shareToken).toEqual(expect.any(String));
      expect(mockCacheService.set).toHaveBeenCalledWith(
        'cache-key',
        result.shareToken,
        expect.any(Number),
      );
      expect(mockActionEntryRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'SHARE_TOKEN_ROTATED' }),
      );
    });

    it('throws NotFoundException when the session does not exist', async () => {
      mockAdminRepo.findOne.mockResolvedValue(validAdmin);
      mockSessionRepo.findOne.mockResolvedValue(null);

      await expect(
        service.rotateShareToken('SVC-ABC123', 'member-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects when the member cannot control the session', async () => {
      mockWorkerProfileRepo.findOne.mockResolvedValue(null);

      await expect(
        service.rotateShareToken('SVC-ABC123', 'member-1'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getActiveSessions', () => {
    it('returns minimal info for every LIVE session, ordered by start time', async () => {
      mockSessionRepo.find.mockResolvedValue([
        {
          sessionCode: 'SVC-ABC123',
          startedAt: new Date('2026-08-02T09:00:00.000Z'),
          programme: {
            serviceSlot: {
              name: 'First Service',
              event: { name: 'Sunday Gathering' },
            },
          },
        },
      ]);

      const result = await service.getActiveSessions();
      expect(mockSessionRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: ServiceSessionStatusEnum.LIVE },
        }),
      );
      expect(result).toEqual([
        {
          sessionCode: 'SVC-ABC123',
          serviceSlotName: 'Sunday Gathering — First Service',
          startedAt: new Date('2026-08-02T09:00:00.000Z'),
        },
      ]);
    });

    it('returns an empty array when no session is live', async () => {
      mockSessionRepo.find.mockResolvedValue([]);
      const result = await service.getActiveSessions();
      expect(result).toEqual([]);
    });
  });

  describe('getActionLog', () => {
    it('returns the most recent entries, newest first', async () => {
      mockAdminRepo.findOne.mockResolvedValue(validAdmin);
      mockSessionRepo.findOne.mockResolvedValue(mockSession);
      mockActionEntryRepo.find.mockResolvedValue([
        {
          createdAt: new Date('2026-08-02T09:05:00.000Z'),
          actorRole: ServiceActionRoleEnum.WORKER,
          action: 'ADVANCED',
          detail: 'position:1',
          performedByMember: { firstname: 'Ada', lastname: 'Obi' },
        },
      ]);

      const result = await service.getActionLog('SVC-ABC123', 'member-1');
      expect(mockActionEntryRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ order: { createdAt: 'DESC' }, take: 10 }),
      );
      expect(result).toEqual([
        {
          createdAt: new Date('2026-08-02T09:05:00.000Z'),
          actorRole: ServiceActionRoleEnum.WORKER,
          actorName: 'Ada Obi',
          action: 'ADVANCED',
          detail: 'position:1',
        },
      ]);
    });

    it('rejects when the member cannot control the session', async () => {
      mockWorkerProfileRepo.findOne.mockResolvedValue(null);
      await expect(
        service.getActionLog('SVC-ABC123', 'member-1'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getActionLogCsv', () => {
    it('builds a CSV with a header row and one row per action entry', async () => {
      mockSessionRepo.findOne.mockResolvedValue(mockSession);
      mockActionEntryRepo.find.mockResolvedValue([
        {
          createdAt: new Date('2026-08-02T09:00:00.000Z'),
          actorRole: ServiceActionRoleEnum.WORKER,
          action: 'SESSION_STARTED',
          detail: null,
          performedByMember: { firstname: 'Ada', lastname: 'Obi' },
        },
        {
          createdAt: new Date('2026-08-02T09:05:00.000Z'),
          actorRole: ServiceActionRoleEnum.PUBLIC_LINK,
          action: 'ADVANCED',
          detail: 'position:1',
          performedByMember: null,
        },
      ]);

      const csv = await service.getActionLogCsv('SVC-ABC123');
      const lines = csv.split('\n');
      expect(lines[0]).toBe('Timestamp,Actor Role,Actor,Action,Detail');
      expect(lines[1]).toContain('Ada Obi');
      expect(lines[1]).toContain('SESSION_STARTED');
      expect(lines[2]).toContain('PUBLIC_LINK');
      expect(lines[2]).toContain('position:1');
    });

    it('throws NotFoundException when the session does not exist', async () => {
      mockSessionRepo.findOne.mockResolvedValue(null);
      await expect(service.getActionLogCsv('SVC-ABC123')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('verifyShareToken', () => {
    it('resolves when the token matches', async () => {
      mockCacheService.get.mockResolvedValue('token-abc');
      await expect(
        service.verifyShareToken('SVC-ABC123', 'token-abc'),
      ).resolves.not.toThrow();
    });

    it('throws ForbiddenException when the token does not match', async () => {
      mockCacheService.get.mockResolvedValue('token-abc');
      await expect(
        service.verifyShareToken('SVC-ABC123', 'wrong-token'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when no token is stored', async () => {
      mockCacheService.get.mockResolvedValue(undefined);
      await expect(
        service.verifyShareToken('SVC-ABC123', 'token-abc'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ── access grants (named PM-link identity) ──────────────────────────────

  describe('generateAccessGrant', () => {
    beforeEach(() => {
      mockAdminRepo.findOne.mockResolvedValue(validAdmin);
      mockSessionRepo.findOne.mockResolvedValue(mockSession);
      mockAccessGrantRepo.find.mockResolvedValue([]);
      mockAccessGrantRepo.create.mockImplementation((data) => data);
      mockAccessGrantRepo.save.mockImplementation((data) =>
        Promise.resolve({ id: 'grant-1', ...data }),
      );
    });

    it('creates a grant with a hashed 6-digit PIN and returns the plaintext PIN once', async () => {
      const result = await service.generateAccessGrant(
        'SVC-ABC123',
        'Ada Obi',
        'member-1',
      );

      expect(result).toEqual({
        id: 'grant-1',
        name: 'Ada Obi',
        pin: expect.stringMatching(/^\d{6}$/),
      });
      expect(mockAccessGrantRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Ada Obi',
          pinHash: expect.any(String),
        }),
      );
      expect(mockAccessGrantRepo.save.mock.calls[0][0].pinHash).not.toBe(
        result.pin,
      );
      expect(mockActionEntryRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ACCESS_GRANT_CREATED' }),
      );
    });

    it('rejects when the caller cannot control the session', async () => {
      mockWorkerProfileRepo.findOne.mockResolvedValue(null);
      mockAdminRepo.findOne.mockResolvedValue(null);
      await expect(
        service.generateAccessGrant('SVC-ABC123', 'Ada', 'member-x'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects a duplicate active name (case/whitespace-insensitive) unless replaceExisting is set', async () => {
      mockAccessGrantRepo.find.mockResolvedValue([
        { id: 'grant-old', name: 'Ada Obi', revokedAt: null },
      ]);

      await expect(
        service.generateAccessGrant('SVC-ABC123', ' ada obi ', 'member-1'),
      ).rejects.toThrow(ConflictException);
      expect(mockAccessGrantRepo.save).not.toHaveBeenCalled();
    });

    it('allows a name matching only a revoked grant', async () => {
      mockAccessGrantRepo.find.mockResolvedValue([
        { id: 'grant-old', name: 'Ada Obi', revokedAt: new Date() },
      ]);

      const result = await service.generateAccessGrant(
        'SVC-ABC123',
        'Ada Obi',
        'member-1',
      );

      expect(result.name).toBe('Ada Obi');
    });

    it('revokes the existing active grant and creates a fresh one when replaceExisting is true', async () => {
      const existing = { id: 'grant-old', name: 'Ada Obi', revokedAt: null };
      mockAccessGrantRepo.find.mockResolvedValue([existing]);

      const result = await service.generateAccessGrant(
        'SVC-ABC123',
        'Ada Obi',
        'member-1',
        true,
      );

      expect(mockAccessGrantRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'grant-old',
          revokedAt: expect.any(Date),
        }),
      );
      expect(mockActionEntryRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ACCESS_GRANT_REPLACED' }),
      );
      expect(result.name).toBe('Ada Obi');
      expect(result.pin).toMatch(/^\d{6}$/);
    });

    it('translates a DB-level unique-constraint race into ConflictException', async () => {
      mockAccessGrantRepo.save.mockRejectedValueOnce({ code: '23505' });

      await expect(
        service.generateAccessGrant('SVC-ABC123', 'Ada Obi', 'member-1'),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('listAccessGrants', () => {
    it('returns grants without exposing pinHash', async () => {
      mockAdminRepo.findOne.mockResolvedValue(validAdmin);
      mockSessionRepo.findOne.mockResolvedValue(mockSession);
      mockAccessGrantRepo.find.mockResolvedValue([
        {
          id: 'grant-1',
          name: 'Ada Obi',
          pinHash: 'should-not-leak',
          createdAt: new Date('2026-08-02T09:00:00.000Z'),
          revokedAt: null,
          lastUsedAt: null,
        },
      ]);

      const result = await service.listAccessGrants('SVC-ABC123', 'member-1');

      expect(result).toEqual([
        {
          id: 'grant-1',
          name: 'Ada Obi',
          createdAt: new Date('2026-08-02T09:00:00.000Z'),
          revokedAt: null,
          lastUsedAt: null,
        },
      ]);
    });
  });

  describe('revokeAccessGrant', () => {
    beforeEach(() => {
      mockAdminRepo.findOne.mockResolvedValue(validAdmin);
      mockSessionRepo.findOne.mockResolvedValue(mockSession);
    });

    it('sets revokedAt on the grant', async () => {
      mockAccessGrantRepo.findOne.mockResolvedValue({
        id: 'grant-1',
        name: 'Ada Obi',
        revokedAt: null,
      });
      mockAccessGrantRepo.save.mockImplementation((g) => Promise.resolve(g));

      await service.revokeAccessGrant('SVC-ABC123', 'grant-1', 'member-1');

      expect(mockAccessGrantRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ revokedAt: expect.any(Date) }),
      );
      expect(mockActionEntryRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ACCESS_GRANT_REVOKED' }),
      );
    });

    it('throws NotFoundException when the grant does not exist', async () => {
      mockAccessGrantRepo.findOne.mockResolvedValue(null);
      await expect(
        service.revokeAccessGrant('SVC-ABC123', 'grant-x', 'member-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('verifyAccessGrant', () => {
    beforeEach(() => {
      mockCacheService.get.mockResolvedValue(liveAnchor);
      mockSessionRepo.findOne.mockResolvedValue(mockSession);
      mockAccessGrantRepo.save.mockImplementation((g) => Promise.resolve(g));
    });

    it('issues a grantToken for a matching, non-revoked name+PIN (case-insensitive name)', async () => {
      const pinHash = await UtilityService.hashValue('123456');
      mockAccessGrantRepo.find.mockResolvedValue([
        { id: 'grant-1', name: 'Ada Obi', pinHash, revokedAt: null },
      ]);

      const result = await service.verifyAccessGrant(
        'SVC-ABC123',
        'ada obi',
        '123456',
      );

      expect(result.name).toBe('Ada Obi');
      expect(typeof result.grantToken).toBe('string');
      expect(mockCacheService.set).toHaveBeenCalledWith(
        'cache-key',
        { grantId: 'grant-1', name: 'Ada Obi' },
        expect.any(Number),
      );
    });

    it('rejects an unknown name', async () => {
      mockAccessGrantRepo.find.mockResolvedValue([]);
      await expect(
        service.verifyAccessGrant('SVC-ABC123', 'Nobody', '123456'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects a revoked grant even with the correct PIN', async () => {
      const pinHash = await UtilityService.hashValue('123456');
      mockAccessGrantRepo.find.mockResolvedValue([
        { id: 'grant-1', name: 'Ada Obi', pinHash, revokedAt: new Date() },
      ]);

      await expect(
        service.verifyAccessGrant('SVC-ABC123', 'Ada Obi', '123456'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects the wrong PIN', async () => {
      const pinHash = await UtilityService.hashValue('123456');
      mockAccessGrantRepo.find.mockResolvedValue([
        { id: 'grant-1', name: 'Ada Obi', pinHash, revokedAt: null },
      ]);

      await expect(
        service.verifyAccessGrant('SVC-ABC123', 'Ada Obi', '000000'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('resolveGrantToken', () => {
    it('returns the grant identity for a cached, non-revoked token', async () => {
      mockCacheService.get.mockResolvedValue({
        grantId: 'grant-1',
        name: 'Ada Obi',
      });
      mockAccessGrantRepo.findOne.mockResolvedValue({
        id: 'grant-1',
        name: 'Ada Obi',
        revokedAt: null,
      });

      const result = await service.resolveGrantToken('SVC-ABC123', 'token-xyz');

      expect(result).toEqual({ grantId: 'grant-1', name: 'Ada Obi' });
    });

    it('rejects when no grantToken is provided', async () => {
      await expect(
        service.resolveGrantToken('SVC-ABC123', undefined),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects when the token is not (or no longer) cached', async () => {
      mockCacheService.get.mockResolvedValue(undefined);
      await expect(
        service.resolveGrantToken('SVC-ABC123', 'token-xyz'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects when the underlying grant has been revoked', async () => {
      mockCacheService.get.mockResolvedValue({
        grantId: 'grant-1',
        name: 'Ada Obi',
      });
      mockAccessGrantRepo.findOne.mockResolvedValue({
        id: 'grant-1',
        name: 'Ada Obi',
        revokedAt: new Date(),
      });

      await expect(
        service.resolveGrantToken('SVC-ABC123', 'token-xyz'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ── advance ───────────────────────────────────────────────────────────────

  describe('getState', () => {
    it('includes the caution threshold ratio from config, defaulting to 0.25', async () => {
      mockSessionRepo.findOne.mockResolvedValue(mockSession);
      mockCacheService.get.mockResolvedValue(liveAnchor);

      const result = await service.getState('SVC-ABC123');

      expect(result.cautionThresholdRatio).toBe(0.25);
      expect(mockConfigService.get).toHaveBeenCalledWith(
        'SERVICE_SLOT_CAUTION_THRESHOLD_RATIO',
        0.25,
      );
    });

    it('reflects a configured override value', async () => {
      mockSessionRepo.findOne.mockResolvedValue(mockSession);
      mockCacheService.get.mockResolvedValue(liveAnchor);
      mockConfigService.get.mockReturnValueOnce(0.4);

      const result = await service.getState('SVC-ABC123');
      expect(result.cautionThresholdRatio).toBe(0.4);
    });

    it('flattens the assigned member name onto each programme slot', async () => {
      mockSessionRepo.findOne.mockResolvedValue({
        ...mockSession,
        programme: {
          ...draftProgramme,
          slots: [
            {
              ...draftProgramme.slots[0],
              member: { firstname: 'Ada', lastname: 'Obi' },
            },
            { ...draftProgramme.slots[1], member: null },
          ],
        },
      });
      mockCacheService.get.mockResolvedValue(liveAnchor);

      const result = await service.getState('SVC-ABC123');
      expect(result.session.programme.slots[0]).toEqual(
        expect.objectContaining({ memberName: 'Ada Obi' }),
      );
      expect(result.session.programme.slots[1]).toEqual(
        expect.objectContaining({ memberName: null }),
      );
    });

    it('builds effectiveSlots from sessionSlots, keyed by ServiceSessionSlot id and resolving overrides', async () => {
      mockSessionRepo.findOne.mockResolvedValue({
        ...mockSession,
        sessionSlots: [
          {
            id: 'ss-0',
            position: 0,
            status: ServiceSessionSlotStatusEnum.IN_PROGRESS,
            adjustedAllocatedMinutes: null,
            overriddenTopic: null,
            overriddenSpeakerName: null,
            overriddenMember: null,
            actualSeconds: null,
            startedAt: null,
            completedAt: null,
            programmeSlot: {
              type: ServiceSlotTypeEnum.SPEAKER,
              topic: 'Original Topic',
              allocatedMinutes: 30,
              member: { firstname: 'Ada', lastname: 'Obi' },
              guestName: null,
              backupMember: { id: 'bm-1', firstname: 'Tunde', lastname: 'Ade' },
              backupGuestName: null,
            },
          },
          {
            id: 'ss-1',
            position: 1,
            status: ServiceSessionSlotStatusEnum.PENDING,
            adjustedAllocatedMinutes: 45,
            overriddenTopic: 'Renamed Topic',
            overriddenSpeakerName: null,
            overriddenMember: { firstname: 'Chidi', lastname: 'Eze' },
            actualSeconds: null,
            startedAt: null,
            completedAt: null,
            programmeSlot: {
              type: ServiceSlotTypeEnum.BREAK,
              topic: 'Original Break',
              allocatedMinutes: 10,
              member: null,
              guestName: 'Guest Speaker',
              backupMember: null,
              backupGuestName: null,
            },
          },
        ],
      });
      mockCacheService.get.mockResolvedValue(liveAnchor);

      const result = await service.getState('SVC-ABC123');

      expect(result.effectiveSlots).toEqual([
        expect.objectContaining({
          id: 'ss-0',
          topic: 'Original Topic',
          allocatedMinutes: 30,
          memberName: 'Ada Obi',
          guestName: null,
          backupMemberId: 'bm-1',
          backupMemberName: 'Tunde Ade',
          backupGuestName: null,
        }),
        expect.objectContaining({
          id: 'ss-1',
          topic: 'Renamed Topic',
          allocatedMinutes: 45,
          memberName: 'Chidi Eze',
          guestName: null,
          backupMemberId: null,
          backupMemberName: null,
          backupGuestName: null,
        }),
      ]);
    });

    it('keeps the backup fixed even when the primary speaker has been overridden', async () => {
      mockSessionRepo.findOne.mockResolvedValue({
        ...mockSession,
        sessionSlots: [
          {
            id: 'ss-0',
            position: 0,
            status: ServiceSessionSlotStatusEnum.IN_PROGRESS,
            adjustedAllocatedMinutes: null,
            overriddenTopic: null,
            overriddenSpeakerName: null,
            overriddenMember: { firstname: 'Chidi', lastname: 'Eze' },
            actualSeconds: null,
            startedAt: null,
            completedAt: null,
            programmeSlot: {
              type: ServiceSlotTypeEnum.SPEAKER,
              topic: 'Original Topic',
              allocatedMinutes: 30,
              member: { firstname: 'Ada', lastname: 'Obi' },
              guestName: null,
              backupMember: { id: 'bm-1', firstname: 'Tunde', lastname: 'Ade' },
              backupGuestName: null,
            },
          },
        ],
      });
      mockCacheService.get.mockResolvedValue(liveAnchor);

      const result = await service.getState('SVC-ABC123');

      expect(result.effectiveSlots[0]).toEqual(
        expect.objectContaining({
          memberName: 'Chidi Eze',
          backupMemberId: 'bm-1',
          backupMemberName: 'Tunde Ade',
        }),
      );
    });
  });

  describe('getMyLiveStatus', () => {
    const buildSlot = (overrides: Record<string, unknown>) => ({
      position: 0,
      status: ServiceSessionSlotStatusEnum.PENDING,
      adjustedAllocatedMinutes: null,
      overriddenTopic: null,
      overriddenSpeakerName: null,
      overriddenMember: null,
      actualSeconds: null,
      startedAt: null,
      completedAt: null,
      programmeSlot: {
        type: ServiceSlotTypeEnum.SPEAKER,
        topic: 'A topic',
        allocatedMinutes: 10,
        member: null,
        guestName: null,
        backupMember: null,
        backupGuestName: null,
      },
      ...overrides,
    });

    it('throws NotFoundException when the member has no slot in this session', async () => {
      mockSessionRepo.findOne.mockResolvedValue({
        ...mockSession,
        sessionSlots: [buildSlot({ position: 0 })],
      });
      mockCacheService.get.mockResolvedValue(liveAnchor);

      await expect(
        service.getMyLiveStatus('SVC-ABC123', 'not-in-this-session'),
      ).rejects.toThrow(NotFoundException);
    });

    it('reports isMyTurnNow when the current position matches my slot', async () => {
      mockSessionRepo.findOne.mockResolvedValue({
        ...mockSession,
        sessionSlots: [
          buildSlot({
            position: 0,
            programmeSlot: {
              ...buildSlot({}).programmeSlot,
              member: { id: 'member-1' },
            },
          }),
        ],
      });
      mockCacheService.get.mockResolvedValue({
        ...liveAnchor,
        currentSlotPosition: 0,
      });

      const result = await service.getMyLiveStatus('SVC-ABC123', 'member-1');

      expect(result.myRole).toBe('PRIMARY');
      expect(result.isMyTurnNow).toBe(true);
      expect(result.hasPassed).toBe(false);
      expect(result.estimatedSecondsUntilMyTurn).toBeNull();
    });

    it('identifies a BACKUP-role match when the member is not the primary speaker', async () => {
      mockSessionRepo.findOne.mockResolvedValue({
        ...mockSession,
        sessionSlots: [
          buildSlot({
            position: 0,
            programmeSlot: {
              ...buildSlot({}).programmeSlot,
              member: { id: 'someone-else' },
              backupMember: { id: 'member-1' },
            },
          }),
        ],
      });
      mockCacheService.get.mockResolvedValue({
        ...liveAnchor,
        currentSlotPosition: 0,
      });

      const result = await service.getMyLiveStatus('SVC-ABC123', 'member-1');
      expect(result.myRole).toBe('BACKUP');
    });

    it('reports hasPassed once the running order has moved beyond my position', async () => {
      mockSessionRepo.findOne.mockResolvedValue({
        ...mockSession,
        sessionSlots: [
          buildSlot({
            position: 0,
            status: ServiceSessionSlotStatusEnum.COMPLETED,
            programmeSlot: {
              ...buildSlot({}).programmeSlot,
              member: { id: 'member-1' },
            },
          }),
          buildSlot({
            position: 1,
            programmeSlot: {
              ...buildSlot({}).programmeSlot,
              member: { id: 'someone-else' },
            },
          }),
        ],
      });
      mockCacheService.get.mockResolvedValue({
        ...liveAnchor,
        currentSlotPosition: 1,
      });

      const result = await service.getMyLiveStatus('SVC-ABC123', 'member-1');
      expect(result.hasPassed).toBe(true);
      expect(result.estimatedSecondsUntilMyTurn).toBeNull();
    });

    it('estimates seconds until my turn as remaining-current-slot plus allocated time of slots in between', async () => {
      mockSessionRepo.findOne.mockResolvedValue({
        ...mockSession,
        sessionSlots: [
          buildSlot({
            position: 0,
            status: ServiceSessionSlotStatusEnum.IN_PROGRESS,
            programmeSlot: {
              ...buildSlot({}).programmeSlot,
              allocatedMinutes: 10, // 600s allocated
              member: { id: 'someone-else' },
            },
          }),
          buildSlot({
            position: 1,
            programmeSlot: {
              ...buildSlot({}).programmeSlot,
              allocatedMinutes: 5, // 300s — the slot in between
              member: { id: 'another-person' },
            },
          }),
          buildSlot({
            position: 2,
            programmeSlot: {
              ...buildSlot({}).programmeSlot,
              member: { id: 'member-1' },
            },
          }),
        ],
      });
      // Anchor: current slot (position 0) started 100s ago, nothing paused —
      // 600s allocated - 100s elapsed = 500s remaining on the current slot.
      mockCacheService.get.mockResolvedValue({
        ...liveAnchor,
        currentSlotPosition: 0,
        slotStartedAt: Date.now() - 100_000,
        slotBaseSeconds: 0,
      });

      const result = await service.getMyLiveStatus('SVC-ABC123', 'member-1');

      expect(result.isMyTurnNow).toBe(false);
      expect(result.hasPassed).toBe(false);
      // ~500s remaining on current + 300s for the in-between slot = ~800s
      expect(result.estimatedSecondsUntilMyTurn).toBeGreaterThan(795);
      expect(result.estimatedSecondsUntilMyTurn).toBeLessThanOrEqual(800);
    });
  });

  describe('advance', () => {
    beforeEach(() => {
      mockAdminRepo.findOne.mockResolvedValue(validAdmin);
      mockCacheService.get.mockResolvedValue(liveAnchor);
      mockSessionRepo.findOne.mockResolvedValue(mockSession);
      mockSessionSlotRepo.count.mockResolvedValue(2);
      mockSessionSlotRepo.update.mockResolvedValue(undefined);
    });

    it('closes current slot and opens next slot', async () => {
      const newAnchor = await service.advance('SVC-ABC123', 'member-1');

      expect(mockSessionSlotRepo.update).toHaveBeenCalledWith(
        expect.objectContaining({ position: 0 }),
        expect.objectContaining({
          status: ServiceSessionSlotStatusEnum.COMPLETED,
        }),
      );
      expect(mockSessionSlotRepo.update).toHaveBeenCalledWith(
        expect.objectContaining({ position: 1 }),
        expect.objectContaining({
          status: ServiceSessionSlotStatusEnum.IN_PROGRESS,
        }),
      );
      expect(newAnchor.currentSlotPosition).toBe(1);
    });

    it('throws BadRequestException when already on last slot', async () => {
      mockSessionSlotRepo.count.mockResolvedValue(1);
      await expect(service.advance('SVC-ABC123', 'member-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NotFoundException when session anchor not in Redis', async () => {
      mockCacheService.get.mockResolvedValue(undefined);
      await expect(service.advance('SVC-ABC123', 'member-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException when session is already completed', async () => {
      mockCacheService.get.mockResolvedValue({
        ...liveAnchor,
        status: ServiceSessionStatusEnum.COMPLETED,
      });
      await expect(service.advance('SVC-ABC123', 'member-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('allows a null memberId (public share link) without checking department access', async () => {
      const newAnchor = await service.advance('SVC-ABC123', null);
      expect(mockWorkerProfileRepo.findOne).not.toHaveBeenCalled();
      expect(newAnchor.currentSlotPosition).toBe(1);
      expect(mockActionEntryRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          actorRole: ServiceActionRoleEnum.PUBLIC_LINK,
        }),
      );
    });
  });

  // ── rewind ────────────────────────────────────────────────────────────────

  describe('rewind', () => {
    const anchorAtSlot1: SessionAnchor = {
      ...liveAnchor,
      currentSlotPosition: 1,
    };
    const currentSlotBefore = {
      id: 'sss-1',
      position: 1,
      status: ServiceSessionSlotStatusEnum.IN_PROGRESS,
      startedAt: new Date('2026-08-02T09:10:00.000Z'),
      completedAt: null,
      actualSeconds: null,
    };
    const prevSlotBefore = {
      id: 'sss-0',
      position: 0,
      status: ServiceSessionSlotStatusEnum.COMPLETED,
      startedAt: new Date('2026-08-02T09:00:00.000Z'),
      completedAt: new Date('2026-08-02T09:09:00.000Z'),
      actualSeconds: 540,
    };

    beforeEach(() => {
      mockAdminRepo.findOne.mockResolvedValue(validAdmin);
      mockCacheService.get.mockResolvedValue(anchorAtSlot1);
      mockSessionRepo.findOne.mockResolvedValue(mockSession);
      mockSessionSlotRepo.update.mockResolvedValue(undefined);
      mockSessionSlotRepo.findOne.mockImplementation(({ where }) =>
        Promise.resolve(
          where.position === 1 ? currentSlotBefore : prevSlotBefore,
        ),
      );
    });

    it('resets current slot and reopens previous slot', async () => {
      const newAnchor = await service.rewind('SVC-ABC123', 'member-1');

      expect(mockSessionSlotRepo.update).toHaveBeenCalledWith(
        expect.objectContaining({ position: 1 }),
        expect.objectContaining({
          status: ServiceSessionSlotStatusEnum.PENDING,
          actualSeconds: null,
        }),
      );
      expect(mockSessionSlotRepo.update).toHaveBeenCalledWith(
        expect.objectContaining({ position: 0 }),
        expect.objectContaining({
          status: ServiceSessionSlotStatusEnum.IN_PROGRESS,
        }),
      );
      expect(newAnchor.currentSlotPosition).toBe(0);
    });

    it('throws BadRequestException when already at first slot', async () => {
      mockCacheService.get.mockResolvedValue(liveAnchor);
      await expect(service.rewind('SVC-ABC123', 'member-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('logs the pre-overwrite slot data so a mistaken rewind is recoverable', async () => {
      await service.rewind('SVC-ABC123', 'member-1');

      expect(mockActionEntryRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'REWIND_SLOT',
          detail: expect.stringContaining(
            JSON.stringify({
              position: prevSlotBefore.position,
              status: prevSlotBefore.status,
              startedAt: prevSlotBefore.startedAt,
              completedAt: prevSlotBefore.completedAt,
              actualSeconds: prevSlotBefore.actualSeconds,
            }),
          ),
        }),
      );
    });
  });

  // ── pause ─────────────────────────────────────────────────────────────────

  describe('pause', () => {
    beforeEach(() => {
      mockAdminRepo.findOne.mockResolvedValue(validAdmin);
      mockCacheService.get.mockResolvedValue(liveAnchor);
      mockSessionRepo.findOne.mockResolvedValue(mockSession);
      mockPauseEntryRepo.create.mockReturnValue({});
      mockPauseEntryRepo.save.mockResolvedValue({});
    });

    it('creates pause entry and sets isPaused in Redis', async () => {
      const dto = { reason: ServicePauseReasonEnum.TECHNICAL_ISSUE };
      const newAnchor = await service.pause('SVC-ABC123', dto, 'member-1');

      expect(mockPauseEntryRepo.save).toHaveBeenCalled();
      expect(newAnchor.isPaused).toBe(true);
      expect(newAnchor.pausedAt).not.toBeNull();
      expect(mockCacheService.set).toHaveBeenCalledWith(
        'cache-key',
        expect.objectContaining({ isPaused: true }),
        expect.any(Number),
      );
    });

    it('throws BadRequestException when session is already paused', async () => {
      mockCacheService.get.mockResolvedValue(pausedAnchor);
      await expect(
        service.pause(
          'SVC-ABC123',
          { reason: ServicePauseReasonEnum.OTHER },
          'member-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── resume ────────────────────────────────────────────────────────────────

  describe('resume', () => {
    beforeEach(() => {
      mockAdminRepo.findOne.mockResolvedValue(validAdmin);
      mockCacheService.get.mockResolvedValue(pausedAnchor);
      mockSessionRepo.findOne.mockResolvedValue(mockSession);
    });

    it('closes pause entry and adjusts slotBaseSeconds', async () => {
      const newAnchor = await service.resume('SVC-ABC123', 'member-1');

      expect(qbMock.execute).toHaveBeenCalled();
      expect(newAnchor.isPaused).toBe(false);
      expect(newAnchor.pausedAt).toBeNull();
      expect(newAnchor.slotBaseSeconds).toBeGreaterThanOrEqual(0);
    });

    it('throws BadRequestException when session is not paused', async () => {
      mockCacheService.get.mockResolvedValue(liveAnchor);
      await expect(service.resume('SVC-ABC123', 'member-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ── adjustTime ───────────────────────────────────────────────────────────

  describe('adjustTime', () => {
    beforeEach(() => {
      mockAdminRepo.findOne.mockResolvedValue(validAdmin);
      mockSessionRepo.findOne.mockResolvedValue(mockSession);
    });

    it('re-anchors slotStartedAt and reduces slotBaseSeconds when running', async () => {
      // Pin "now" to exactly 60s after slotStartedAt so the elapsed-time
      // math is deterministic — asserting against the real wall clock here
      // made this test's pass/fail depend on how long the rest of the
      // suite took to reach it.
      const fixedNow = liveAnchor.slotStartedAt + 60_000;
      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(fixedNow);
      try {
        mockCacheService.get.mockResolvedValue(liveAnchor);
        const newAnchor = await service.adjustTime(
          'SVC-ABC123',
          30,
          'member-1',
        );

        expect(newAnchor.slotStartedAt).toBe(fixedNow);
        expect(newAnchor.slotBaseSeconds).toBe(30);
        expect(mockCacheService.set).toHaveBeenCalledWith(
          'cache-key',
          expect.objectContaining({ slotBaseSeconds: 30 }),
          expect.any(Number),
        );
      } finally {
        nowSpy.mockRestore();
      }
    });

    it('adjusts slotBaseSeconds only (no re-anchor) when paused', async () => {
      mockCacheService.get.mockResolvedValue(pausedAnchor);
      const newAnchor = await service.adjustTime('SVC-ABC123', 10, 'member-1');

      expect(newAnchor.slotStartedAt).toBe(pausedAnchor.slotStartedAt);
      expect(newAnchor.pausedAt).toBe(pausedAnchor.pausedAt);
      expect(newAnchor.slotBaseSeconds).toBeCloseTo(20, 0);
    });

    it('clamps elapsed time to zero when the delta exceeds it', async () => {
      mockCacheService.get.mockResolvedValue(liveAnchor);
      const newAnchor = await service.adjustTime(
        'SVC-ABC123',
        1000,
        'member-1',
      );

      expect(newAnchor.slotBaseSeconds).toBe(0);
    });
  });

  // ── overrideSlot ─────────────────────────────────────────────────────────

  describe('overrideSlot', () => {
    const mockSessionSlot = {
      id: 'sss-0',
      position: 0,
      overriddenSpeakerName: null,
      overriddenTopic: null,
      adjustedAllocatedMinutes: null,
      overriddenMember: null,
    };

    beforeEach(() => {
      mockAdminRepo.findOne.mockResolvedValue(validAdmin);
      mockSessionRepo.findOne.mockResolvedValue(mockSession);
      mockSessionSlotRepo.findOne.mockResolvedValue(mockSessionSlot);
      mockSessionSlotRepo.save.mockResolvedValue({
        ...mockSessionSlot,
        overriddenSpeakerName: 'Pst John',
      });
    });

    it('updates overridden speaker name', async () => {
      const dto = { overriddenSpeakerName: 'Pst John' };
      const result = await service.overrideSlot(
        'SVC-ABC123',
        0,
        dto,
        'member-1',
      );
      expect(result.overriddenSpeakerName).toBe('Pst John');
    });

    it('throws NotFoundException when slot position does not exist', async () => {
      mockSessionSlotRepo.findOne.mockResolvedValue(null);
      await expect(
        service.overrideSlot('SVC-ABC123', 99, {}, 'member-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('allows the public Programme Manager link (memberId null) to override a slot, logged as PUBLIC_LINK', async () => {
      const dto = { overriddenTopic: 'Renamed' };
      const result = await service.overrideSlot('SVC-ABC123', 0, dto, null);
      expect(mockWorkerProfileRepo.findOne).not.toHaveBeenCalled();
      expect(result.overriddenSpeakerName).toBe('Pst John');
      expect(mockActionEntryRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'SLOT_OVERRIDE',
          actorRole: ServiceActionRoleEnum.PUBLIC_LINK,
        }),
      );
    });
  });

  // ── reorderLiveSlots ─────────────────────────────────────────────────────

  describe('reorderLiveSlots', () => {
    const allSlots = [
      { id: 'sss-0', position: 0 },
      { id: 'sss-1', position: 1 },
      { id: 'sss-2', position: 2 },
      { id: 'sss-3', position: 3 },
    ];

    beforeEach(() => {
      mockAdminRepo.findOne.mockResolvedValue(validAdmin);
      mockCacheService.get.mockResolvedValue(liveAnchor); // currentSlotPosition: 0
      mockSessionRepo.findOne.mockResolvedValue(mockSession);
      mockSessionSlotRepo.find.mockResolvedValue(allSlots);
      mockDataSource.transaction.mockImplementation(async (cb) =>
        cb({ save: (Entity, data) => Promise.resolve(data) }),
      );
    });

    it('reassigns positions for the upcoming (pending) tail only', async () => {
      const result = await service.reorderLiveSlots(
        'SVC-ABC123',
        ['sss-3', 'sss-1', 'sss-2'],
        'member-1',
      );
      expect(result.map((s) => s.id)).toEqual(['sss-3', 'sss-1', 'sss-2']);
      expect(result.map((s) => s.position)).toEqual([1, 2, 3]);
    });

    it('throws BadRequestException when the id set omits a pending slot', async () => {
      await expect(
        service.reorderLiveSlots('SVC-ABC123', ['sss-3', 'sss-1'], 'member-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when an id is not part of the pending tail', async () => {
      await expect(
        service.reorderLiveSlots(
          'SVC-ABC123',
          ['sss-0', 'sss-1', 'sss-2'],
          'member-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── getFullEventReportPdf ─────────────────────────────────────────────────

  describe('getFullEventReportPdf', () => {
    const buildQb = (sessions: object[]) => ({
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(sessions),
    });

    const completedSession = {
      id: 'sess-2',
      sessionCode: 'SVC-EVT001',
      status: ServiceSessionStatusEnum.COMPLETED,
      startedAt: new Date('2026-06-15T09:00:00Z'),
      endedAt: new Date('2026-06-15T11:00:00Z'),
      sessionSlots: [],
      pauseEntries: [],
      programme: {
        id: 'prog-2',
        serviceSlot: {
          name: 'First Service',
          startTime: new Date('2026-06-15T09:00:00Z'),
          endTime: new Date('2026-06-15T11:00:00Z'),
          event: { name: 'Sunday Service', eventDate: '2026-06-15' },
        },
      },
    };

    it('throws NotFoundException when no sessions found for event', async () => {
      mockSessionRepo.createQueryBuilder.mockReturnValue(buildQb([]));
      await expect(service.getFullEventReportPdf('event-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException when a session is not yet completed', async () => {
      const liveSession = {
        ...completedSession,
        status: ServiceSessionStatusEnum.LIVE,
      };
      mockSessionRepo.createQueryBuilder.mockReturnValue(
        buildQb([liveSession]),
      );
      await expect(service.getFullEventReportPdf('event-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('generates full event report PDF when all sessions are completed', async () => {
      mockSessionRepo.createQueryBuilder.mockReturnValue(
        buildQb([completedSession]),
      );
      const buf = await service.getFullEventReportPdf('event-1');
      expect(mockPdfService.generateFullEventReport).toHaveBeenCalledWith(
        expect.objectContaining({
          eventName: 'Sunday Service',
          eventDate: '2026-06-15',
          sessions: expect.arrayContaining([
            expect.objectContaining({ serviceSlotName: 'First Service' }),
          ]),
          summary: expect.objectContaining({
            sessionCount: 1,
            totalAllocatedMinutes: expect.any(Number),
            totalSlotVarianceMinutes: expect.any(Number),
            avgCompletionRate: expect.any(Number),
          }),
        }),
      );
      expect(buf).toEqual(Buffer.from('pdf'));
    });
  });

  // ── getAnalytics ──────────────────────────────────────────────────────────

  describe('getAnalytics', () => {
    const buildQb = (sessions: object[]) => ({
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(sessions),
    });

    const completedSession = {
      sessionCode: 'SVC-ANL001',
      startedAt: new Date('2026-06-15T09:00:00Z'),
      endedAt: new Date('2026-06-15T11:00:00Z'),
      sessionSlots: [],
      pauseEntries: [],
    };

    it('returns aggregated totals for completed sessions', async () => {
      const qb = buildQb([completedSession]);
      mockSessionRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getAnalytics();
      expect(result.totalSessions).toBe(1);
      expect(result.sessions[0].sessionCode).toBe('SVC-ANL001');
    });

    it('defaults to a bounded ~180-day lookback instead of scanning full history when no "from" is given', async () => {
      const qb = buildQb([completedSession]);
      mockSessionRepo.createQueryBuilder.mockReturnValue(qb);

      await service.getAnalytics();

      const call = qb.andWhere.mock.calls.find(
        (c: unknown[]) => c[0] === 'session.startedAt >= :from',
      );
      expect(call).toBeDefined();
      const usedFrom = (call![1] as { from: Date }).from;
      const daysAgo = (Date.now() - usedFrom.getTime()) / (1000 * 60 * 60 * 24);
      expect(daysAgo).toBeGreaterThan(179);
      expect(daysAgo).toBeLessThan(181);
    });

    it('uses the caller-supplied "from" as-is instead of the default when provided', async () => {
      const qb = buildQb([completedSession]);
      mockSessionRepo.createQueryBuilder.mockReturnValue(qb);

      await service.getAnalytics('2020-01-01');

      expect(qb.andWhere).toHaveBeenCalledWith('session.startedAt >= :from', {
        from: new Date('2020-01-01'),
      });
    });

    it('filters by either the sub-service name or the parent event name — not just the sub-service', async () => {
      const qb = buildQb([completedSession]);
      mockSessionRepo.createQueryBuilder.mockReturnValue(qb);

      await service.getAnalytics(undefined, undefined, 'Sunday Service');

      expect(qb.andWhere).toHaveBeenCalledWith(
        '(serviceSlot.name ILIKE :name OR event.name ILIKE :name)',
        { name: '%Sunday Service%' },
      );
      expect(qb.leftJoinAndSelect).toHaveBeenCalledWith(
        'serviceSlot.event',
        'event',
      );
    });

    it('returns an empty result when no completed sessions match', async () => {
      mockSessionRepo.createQueryBuilder.mockReturnValue(buildQb([]));
      const result = await service.getAnalytics(undefined, undefined, 'Nope');
      expect(result.totalSessions).toBe(0);
      expect(result.sessions).toEqual([]);
      expect(result.slotTypeStats).toEqual([]);
      expect(result.topSpeakers).toEqual([]);
    });

    it('scopes sessions to the given member via a session-slot subquery', async () => {
      const qb = buildQb([completedSession]);
      mockSessionRepo.createQueryBuilder.mockReturnValue(qb);

      await service.getAnalytics(undefined, undefined, undefined, 'member-1');

      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('service_session_slots'),
        { memberId: 'member-1' },
      );
    });

    const mixedSession = {
      sessionCode: 'SVC-MIX001',
      startedAt: new Date('2026-06-15T09:00:00Z'),
      endedAt: new Date('2026-06-15T11:00:00Z'),
      pauseEntries: [],
      sessionSlots: [
        {
          status: ServiceSessionSlotStatusEnum.COMPLETED,
          actualSeconds: 700,
          adjustedAllocatedMinutes: null,
          overriddenMember: null,
          programmeSlot: {
            type: 'SPEAKER',
            allocatedMinutes: 10,
            member: { id: 'member-1', firstname: 'Ada', lastname: 'Obi' },
          },
        },
        {
          status: ServiceSessionSlotStatusEnum.COMPLETED,
          actualSeconds: 500,
          adjustedAllocatedMinutes: null,
          overriddenMember: null,
          programmeSlot: {
            type: 'WORSHIP',
            allocatedMinutes: 10,
            member: { id: 'member-2', firstname: 'Ben', lastname: 'Uche' },
          },
        },
      ],
    };

    it('restricts the slot-type breakdown to the requested type only, leaving completionRate session-wide', async () => {
      mockSessionRepo.createQueryBuilder.mockReturnValue(
        buildQb([mixedSession]),
      );

      const result = await service.getAnalytics(
        undefined,
        undefined,
        undefined,
        undefined,
        'SPEAKER',
      );

      expect(result.slotTypeStats).toHaveLength(1);
      expect(result.slotTypeStats[0].type).toBe('SPEAKER');
      expect(result.sessions[0].completionRate).toBe(100); // both slots completed, unfiltered
      expect(result.sessions[0].overrunSlots).toBe(1); // only the SPEAKER slot counted (700s actual vs 600s allocated — it did overrun)
    });

    it('restricts the slot-type breakdown to the requested member only, ignoring co-presenters in the same session', async () => {
      mockSessionRepo.createQueryBuilder.mockReturnValue(
        buildQb([mixedSession]),
      );

      const result = await service.getAnalytics(
        undefined,
        undefined,
        undefined,
        'member-2',
      );

      expect(result.topSpeakers).toEqual([]); // member-2's slot is WORSHIP, not SPEAKER — topSpeakers stays SPEAKER-only
      expect(result.slotTypeStats).toHaveLength(1);
      expect(result.slotTypeStats[0].type).toBe('WORSHIP');
    });
  });

  describe('getMyServiceHistory', () => {
    const buildQb = (sessions: object[]) => ({
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(sessions),
    });

    const buildSession = (over: Record<string, unknown>) => ({
      startedAt: new Date('2026-06-15T09:00:00Z'),
      programme: {
        serviceSlot: {
          name: 'First Service',
          event: { name: 'Sunday Service' },
        },
      },
      sessionSlots: [],
      ...over,
    });

    it('only includes slots where I was the effective speaker (override or original assignment), not a listed backup who never went on', async () => {
      const session = buildSession({
        sessionSlots: [
          {
            programmeSlot: {
              type: ServiceSlotTypeEnum.SPEAKER,
              topic: 'Faith',
              allocatedMinutes: 30,
              member: { id: 'member-1' },
            },
            overriddenMember: null,
            overriddenTopic: null,
            adjustedAllocatedMinutes: null,
            actualSeconds: 1800,
          },
          {
            // member-1 is listed as backup here but never actually presented
            programmeSlot: {
              type: ServiceSlotTypeEnum.WORSHIP,
              topic: null,
              allocatedMinutes: 20,
              member: { id: 'someone-else' },
              backupMember: { id: 'member-1' },
            },
            overriddenMember: null,
            overriddenTopic: null,
            adjustedAllocatedMinutes: null,
            actualSeconds: 1200,
          },
        ],
      });
      mockSessionRepo.createQueryBuilder.mockReturnValue(buildQb([session]));

      const result = await service.getMyServiceHistory('member-1');

      expect(result.totalSlots).toBe(1);
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]).toEqual(
        expect.objectContaining({
          eventName: 'Sunday Service',
          serviceSlotName: 'First Service',
          type: ServiceSlotTypeEnum.SPEAKER,
          actualSeconds: 1800,
        }),
      );
      expect(result.totalActualSeconds).toBe(1800);
    });

    it('credits an override to whoever actually stepped in, not the originally-assigned member', async () => {
      const session = buildSession({
        sessionSlots: [
          {
            programmeSlot: {
              type: ServiceSlotTypeEnum.SPEAKER,
              topic: 'Faith',
              allocatedMinutes: 30,
              member: { id: 'originally-assigned' },
            },
            overriddenMember: { id: 'member-1' },
            overriddenTopic: null,
            adjustedAllocatedMinutes: null,
            actualSeconds: 900,
          },
        ],
      });
      mockSessionRepo.createQueryBuilder.mockReturnValue(buildQb([session]));

      const result = await service.getMyServiceHistory('member-1');
      expect(result.totalSlots).toBe(1);
      expect(result.totalActualSeconds).toBe(900);
    });

    it('aggregates totals by slot type across sessions', async () => {
      const speakerSlot = (actualSeconds: number) => ({
        programmeSlot: {
          type: ServiceSlotTypeEnum.SPEAKER,
          topic: 'A topic',
          allocatedMinutes: 30,
          member: { id: 'member-1' },
        },
        overriddenMember: null,
        overriddenTopic: null,
        adjustedAllocatedMinutes: null,
        actualSeconds,
      });
      const sessions = [
        buildSession({ sessionSlots: [speakerSlot(600)] }),
        buildSession({ sessionSlots: [speakerSlot(700)] }),
      ];
      mockSessionRepo.createQueryBuilder.mockReturnValue(buildQb(sessions));

      const result = await service.getMyServiceHistory('member-1');
      expect(result.bySlotType).toEqual([
        {
          type: ServiceSlotTypeEnum.SPEAKER,
          count: 2,
          totalActualSeconds: 1300,
        },
      ]);
    });

    it('paginates entries while keeping summary totals computed over the full set', async () => {
      const slot = (n: number) => ({
        programmeSlot: {
          type: ServiceSlotTypeEnum.SPEAKER,
          topic: `Topic ${n}`,
          allocatedMinutes: 10,
          member: { id: 'member-1' },
        },
        overriddenMember: null,
        overriddenTopic: null,
        adjustedAllocatedMinutes: null,
        actualSeconds: 100,
      });
      const sessions = Array.from({ length: 15 }, (_, i) =>
        buildSession({ sessionSlots: [slot(i)] }),
      );
      mockSessionRepo.createQueryBuilder.mockReturnValue(buildQb(sessions));

      const result = await service.getMyServiceHistory('member-1', 2, 10);

      expect(result.totalCount).toBe(15);
      expect(result.totalSlots).toBe(15);
      expect(result.entries).toHaveLength(5); // page 2 of 10 — remaining 5
      expect(result.page).toBe(2);
      expect(result.totalPages).toBe(2);
    });
  });

  describe('getEventSummaryReportPdfForWorker', () => {
    const buildQb = (sessions: object[]) => ({
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(sessions),
    });

    it('allows an Admin-department worker regardless of SERVICE_PROGRAMME_WRITE — a separate, narrower check than session control', async () => {
      mockWorkerProfileRepo.findOne.mockResolvedValue(adminDeptProfile);
      mockAdminRepo.findOne.mockResolvedValue(null);
      mockSessionRepo.createQueryBuilder.mockReturnValue(buildQb([]));

      await expect(
        service.getEventSummaryReportPdfForWorker('event-1', 'member-1'),
      ).rejects.toThrow(NotFoundException); // reaches the report logic, not a 403
    });

    it('rejects a worker who is not in the Admin department, even if they are also an Admin with SERVICE_PROGRAMME_WRITE', async () => {
      mockWorkerProfileRepo.findOne.mockResolvedValue(nonAdminProfile);
      mockAdminRepo.findOne.mockResolvedValue(validAdmin);

      await expect(
        service.getEventSummaryReportPdfForWorker('event-1', 'member-2'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ── end ───────────────────────────────────────────────────────────────────

  describe('end', () => {
    beforeEach(() => {
      mockAdminRepo.findOne.mockResolvedValue(validAdmin);
      mockCacheService.get.mockResolvedValue(liveAnchor);
      mockSessionRepo.findOne.mockResolvedValue({
        ...mockSession,
        programme: draftProgramme,
      });
      mockDataSource.transaction.mockImplementation(async (cb) =>
        cb({
          update: jest.fn().mockResolvedValue(undefined),
          createQueryBuilder: jest.fn().mockReturnValue(qbMock),
        }),
      );
      mockProgrammeSvc.setProgrammeStatus.mockResolvedValue(undefined);
      mockProgrammeSvc.upsertTemplateFromProgramme.mockResolvedValue(undefined);
    });

    it('marks session as COMPLETED and transitions programme status', async () => {
      await service.end('SVC-ABC123', 'member-1');

      expect(mockProgrammeSvc.setProgrammeStatus).toHaveBeenCalledWith(
        draftProgramme.id,
        ServiceProgrammeStatusEnum.COMPLETED,
      );
      expect(mockCacheService.set).toHaveBeenCalledWith(
        'cache-key',
        expect.objectContaining({ status: ServiceSessionStatusEnum.COMPLETED }),
        expect.any(Number),
      );
    });

    it('does not upsert template when saveAsTemplate is false', async () => {
      await service.end('SVC-ABC123', 'member-1');
      expect(
        mockProgrammeSvc.upsertTemplateFromProgramme,
      ).not.toHaveBeenCalled();
    });

    it('upserts template when saveAsTemplate is true', async () => {
      const progWithTemplate = { ...draftProgramme, saveAsTemplate: true };
      mockSessionRepo.findOne.mockResolvedValue({
        ...mockSession,
        programme: progWithTemplate,
      });

      await service.end('SVC-ABC123', 'member-1');
      expect(mockProgrammeSvc.upsertTemplateFromProgramme).toHaveBeenCalledWith(
        progWithTemplate,
      );
    });

    it('closes any still-open pause entry so it is not silently dropped from the report', async () => {
      await service.end('SVC-ABC123', 'member-1');

      expect(qbMock.update).toHaveBeenCalledWith(ServicePauseEntry);
      expect(qbMock.set).toHaveBeenCalledWith({
        resumedAt: expect.any(Date),
      });
      expect(qbMock.where).toHaveBeenCalledWith(
        'session_id = :sid AND resumed_at IS NULL',
        { sid: mockSession.id },
      );
      expect(qbMock.execute).toHaveBeenCalled();
    });
  });
});
