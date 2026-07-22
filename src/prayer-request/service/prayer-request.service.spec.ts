import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrayerRequestService } from './prayer-request.service';
import { PrayerRequest } from '../entity/prayer-request.entity';
import { Testimony } from '../entity/testimony.entity';
import { PregnancyPrayerCase } from '../entity/pregnancy-prayer-case.entity';
import { PregnancyPrayerVisit } from '../entity/pregnancy-prayer-visit.entity';
import { Pastor } from '../../member/entity/pastor.entity';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { MemberService } from '../../member/service/member.service';
import { PrayerRequestStatusEnum } from '../enum/prayer-request-status.enum';
import { PregnancyCaseStatusEnum } from '../enum/pregnancy-case-status.enum';
import { DepartmentKeyEnum } from '../../department/enums/department-key.enum';
import { DepartmentAccessService } from '../../department/service/department-access.service';
import { MemberAuth } from '../../auth/interface/auth.interface';
import { MemberRoleEnum } from '../../member/enums/member-role.enum';
import { SessionSurface } from '../../auth/enum/session-surface.enum';

const mockPrayerRequestRepo = {
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  findAndCount: jest.fn(),
};

const mockTestimonyRepo = {
  create: jest.fn(),
  save: jest.fn(),
  findAndCount: jest.fn(),
};

const mockPregnancyCaseRepo = {
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  findAndCount: jest.fn(),
  existsBy: jest.fn(),
};

const mockPregnancyVisitRepo = {
  create: jest.fn(),
  save: jest.fn(),
  findAndCount: jest.fn(),
};

const mockDepartmentAccessService = {
  hasDepartmentAccessKey: jest.fn(),
  assertHasDepartmentAccessKey: jest.fn(),
};

const mockPastorRepo = {
  exists: jest.fn(),
};

const mockAuditLogService = { log: jest.fn() };

const mockMemberService = {
  getById: jest.fn(),
};

const currentUser: MemberAuth = {
  id: 'member-1',
  role: MemberRoleEnum.MEMBER,
  requiresPasswordChange: false,
  surface: SessionSurface.MEMBER,
};

const member = { id: 'member-1', firstname: 'Ada', lastname: 'Lovelace' };

describe('PrayerRequestService', () => {
  let service: PrayerRequestService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrayerRequestService,
        {
          provide: getRepositoryToken(PrayerRequest),
          useValue: mockPrayerRequestRepo,
        },
        { provide: getRepositoryToken(Testimony), useValue: mockTestimonyRepo },
        {
          provide: getRepositoryToken(PregnancyPrayerCase),
          useValue: mockPregnancyCaseRepo,
        },
        {
          provide: getRepositoryToken(PregnancyPrayerVisit),
          useValue: mockPregnancyVisitRepo,
        },
        { provide: getRepositoryToken(Pastor), useValue: mockPastorRepo },
        { provide: AuditLogService, useValue: mockAuditLogService },
        { provide: MemberService, useValue: mockMemberService },
        {
          provide: DepartmentAccessService,
          useValue: mockDepartmentAccessService,
        },
      ],
    }).compile();

    service = module.get<PrayerRequestService>(PrayerRequestService);
  });

  describe('submitRequest', () => {
    it('creates a prayer request with a snapshot name and OPEN status', async () => {
      mockMemberService.getById.mockResolvedValue(member);
      const created = { id: 'pr-1' };
      mockPrayerRequestRepo.create.mockReturnValue(created);
      mockPrayerRequestRepo.save.mockResolvedValue(created);

      const result = await service.submitRequest(
        { content: 'Please pray for my family' },
        currentUser,
      );

      expect(mockPrayerRequestRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          submittedByName: 'Ada Lovelace',
          content: 'Please pray for my family',
          status: PrayerRequestStatusEnum.OPEN,
        }),
      );
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'PRAYER_REQUEST_SUBMITTED',
        expect.objectContaining({ actorId: 'member-1', targetId: 'pr-1' }),
      );
      expect(result).toEqual(created);
    });
  });

  describe('submitTestimony', () => {
    it('creates a general testimony when no prayerRequestId is given', async () => {
      mockMemberService.getById.mockResolvedValue(member);
      const created = { id: 'test-1' };
      mockTestimonyRepo.create.mockReturnValue(created);
      mockTestimonyRepo.save.mockResolvedValue(created);

      const result = await service.submitTestimony(
        { content: 'God is faithful', isPublic: true },
        currentUser,
      );

      expect(mockPrayerRequestRepo.findOne).not.toHaveBeenCalled();
      expect(mockTestimonyRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          submittedByName: 'Ada Lovelace',
          prayerRequest: null,
          isPublic: true,
        }),
      );
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'TESTIMONY_SUBMITTED',
        expect.objectContaining({ actorId: 'member-1', targetId: 'test-1' }),
      );
      expect(result).toEqual(created);
    });

    it('throws NotFoundException when prayerRequestId does not exist', async () => {
      mockMemberService.getById.mockResolvedValue(member);
      mockPrayerRequestRepo.findOne.mockResolvedValue(null);

      await expect(
        service.submitTestimony(
          { content: 'Answered!', prayerRequestId: 'missing' },
          currentUser,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when the prayer request belongs to someone else', async () => {
      mockMemberService.getById.mockResolvedValue(member);
      mockPrayerRequestRepo.findOne.mockResolvedValue({
        id: 'pr-1',
        member: { id: 'someone-else' },
      });

      await expect(
        service.submitTestimony(
          { content: 'Answered!', prayerRequestId: 'pr-1' },
          currentUser,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it("links the testimony to the caller's own prayer request", async () => {
      mockMemberService.getById.mockResolvedValue(member);
      mockPrayerRequestRepo.findOne.mockResolvedValue({
        id: 'pr-1',
        member: { id: 'member-1' },
      });
      const created = { id: 'test-1' };
      mockTestimonyRepo.create.mockReturnValue(created);
      mockTestimonyRepo.save.mockResolvedValue(created);

      await service.submitTestimony(
        { content: 'Answered!', prayerRequestId: 'pr-1' },
        currentUser,
      );

      expect(mockTestimonyRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ prayerRequest: { id: 'pr-1' } }),
      );
    });
  });

  describe('getMyRequests / getMyTestimonies / getPublicTestimonies', () => {
    it("paginates the caller's own requests", async () => {
      mockPrayerRequestRepo.findAndCount.mockResolvedValue([
        [{ id: 'pr-1' }],
        1,
      ]);

      const result = await service.getMyRequests('member-1', 1, 10);

      expect(mockPrayerRequestRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: { member: { id: 'member-1' } } }),
      );
      expect(result.data).toHaveLength(1);
    });

    it('paginates the public testimony feed', async () => {
      mockTestimonyRepo.findAndCount.mockResolvedValue([[{ id: 'test-1' }], 1]);

      const result = await service.getPublicTestimonies(1, 10);

      expect(mockTestimonyRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isPublic: true } }),
      );
      expect(result.data).toHaveLength(1);
    });
  });

  describe('updateStatus', () => {
    it('throws NotFoundException when the request does not exist', async () => {
      mockPrayerRequestRepo.findOne.mockResolvedValue(null);

      await expect(
        service.updateStatus(
          'missing',
          { status: PrayerRequestStatusEnum.PRAYED_FOR },
          'actor-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('updates the status and audit-logs it', async () => {
      const request = { id: 'pr-1', status: PrayerRequestStatusEnum.OPEN };
      mockPrayerRequestRepo.findOne.mockResolvedValue(request);
      mockPrayerRequestRepo.save.mockImplementation((r) => Promise.resolve(r));

      const result = await service.updateStatus(
        'pr-1',
        { status: PrayerRequestStatusEnum.ANSWERED },
        'actor-1',
      );

      expect(result.status).toBe(PrayerRequestStatusEnum.ANSWERED);
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'PRAYER_REQUEST_STATUS_UPDATED',
        expect.objectContaining({
          actorId: 'actor-1',
          metadata: { status: PrayerRequestStatusEnum.ANSWERED },
        }),
      );
    });
  });

  describe('createPregnancyCase', () => {
    it('creates a pregnancy case with a creator name snapshot and ACTIVE status', async () => {
      mockMemberService.getById.mockResolvedValue(member);
      const created = { id: 'preg-1' };
      mockPregnancyCaseRepo.create.mockReturnValue(created);
      mockPregnancyCaseRepo.save.mockResolvedValue(created);

      const result = await service.createPregnancyCase(
        { name: 'Jane Doe', edd: '2026-12-01' },
        currentUser,
      );

      expect(mockPregnancyCaseRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Jane Doe',
          edd: '2026-12-01',
          member: null,
          status: PregnancyCaseStatusEnum.ACTIVE,
          createdByName: 'Ada Lovelace',
        }),
      );
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'PREGNANCY_CASE_CREATED',
        expect.objectContaining({ actorId: 'member-1', targetId: 'preg-1' }),
      );
      expect(result).toEqual(created);
    });

    it('links the case to a member when memberId is given', async () => {
      mockMemberService.getById.mockResolvedValue(member);
      mockPregnancyCaseRepo.create.mockReturnValue({ id: 'preg-1' });
      mockPregnancyCaseRepo.save.mockResolvedValue({ id: 'preg-1' });

      await service.createPregnancyCase(
        { name: 'Jane Doe', edd: '2026-12-01', memberId: 'member-2' },
        currentUser,
      );

      expect(mockPregnancyCaseRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ member: { id: 'member-2' } }),
      );
    });
  });

  describe('logPregnancyVisit', () => {
    it('throws NotFoundException when the case does not exist', async () => {
      mockPregnancyCaseRepo.findOne.mockResolvedValue(null);

      await expect(
        service.logPregnancyVisit('missing', {}, currentUser),
      ).rejects.toThrow(NotFoundException);
    });

    it('logs a visit and updates lastPrayedAt on the case', async () => {
      const pregnancyCase = { id: 'preg-1', lastPrayedAt: null };
      mockPregnancyCaseRepo.findOne.mockResolvedValue(pregnancyCase);
      mockMemberService.getById.mockResolvedValue(member);
      const visitedAt = new Date();
      const savedVisit = { id: 'visit-1', visitedAt };
      mockPregnancyVisitRepo.create.mockReturnValue(savedVisit);
      mockPregnancyVisitRepo.save.mockResolvedValue(savedVisit);
      mockPregnancyCaseRepo.save.mockImplementation((c) => Promise.resolve(c));

      const result = await service.logPregnancyVisit(
        'preg-1',
        { note: 'Prayed together' },
        currentUser,
      );

      expect(mockPregnancyVisitRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          case: pregnancyCase,
          loggedByName: 'Ada Lovelace',
          note: 'Prayed together',
        }),
      );
      expect(pregnancyCase.lastPrayedAt).toBe(visitedAt);
      expect(mockPregnancyCaseRepo.save).toHaveBeenCalledWith(pregnancyCase);
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'PREGNANCY_VISIT_LOGGED',
        expect.objectContaining({ actorId: 'member-1', targetId: 'visit-1' }),
      );
      expect(result).toEqual(savedVisit);
    });
  });

  describe('getPregnancyCases', () => {
    it('paginates and filters by status when given', async () => {
      mockPregnancyCaseRepo.findAndCount.mockResolvedValue([
        [{ id: 'preg-1' }],
        1,
      ]);

      const result = await service.getPregnancyCases(
        1,
        10,
        PregnancyCaseStatusEnum.ACTIVE,
      );

      expect(mockPregnancyCaseRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: PregnancyCaseStatusEnum.ACTIVE },
        }),
      );
      expect(result.data).toHaveLength(1);
    });
  });

  describe('updatePregnancyCaseStatus', () => {
    it('throws NotFoundException when the case does not exist', async () => {
      mockPregnancyCaseRepo.findOne.mockResolvedValue(null);

      await expect(
        service.updatePregnancyCaseStatus(
          'missing',
          { status: PregnancyCaseStatusEnum.DELIVERED },
          'actor-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('updates the status and audit-logs it', async () => {
      const pregnancyCase = {
        id: 'preg-1',
        status: PregnancyCaseStatusEnum.ACTIVE,
      };
      mockPregnancyCaseRepo.findOne.mockResolvedValue(pregnancyCase);
      mockPregnancyCaseRepo.save.mockImplementation((c) => Promise.resolve(c));

      const result = await service.updatePregnancyCaseStatus(
        'preg-1',
        { status: PregnancyCaseStatusEnum.DELIVERED },
        'actor-1',
      );

      expect(result.status).toBe(PregnancyCaseStatusEnum.DELIVERED);
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'PREGNANCY_CASE_STATUS_UPDATED',
        expect.objectContaining({
          actorId: 'actor-1',
          metadata: { status: PregnancyCaseStatusEnum.DELIVERED },
        }),
      );
    });
  });

  describe('getPregnancyVisitHistory', () => {
    it('throws NotFoundException when the case does not exist', async () => {
      mockPregnancyCaseRepo.existsBy.mockResolvedValue(false);

      await expect(service.getPregnancyVisitHistory('missing')).rejects.toThrow(
        NotFoundException,
      );
      expect(mockPregnancyVisitRepo.findAndCount).not.toHaveBeenCalled();
    });

    it('paginates the visit log ordered newest-first', async () => {
      mockPregnancyCaseRepo.existsBy.mockResolvedValue(true);
      mockPregnancyVisitRepo.findAndCount.mockResolvedValue([
        [{ id: 'visit-1' }, { id: 'visit-2' }],
        2,
      ]);

      const result = await service.getPregnancyVisitHistory('preg-1', 1, 10);

      expect(mockPregnancyVisitRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { case: { id: 'preg-1' } },
          order: { visitedAt: 'DESC' },
        }),
      );
      expect(result.data).toHaveLength(2);
    });
  });

  describe('assertIsPrayerTeamOrPastor', () => {
    it('resolves when the member is a Pastor', async () => {
      mockPastorRepo.exists.mockResolvedValue(true);

      await expect(
        service.assertIsPrayerTeamOrPastor('member-1'),
      ).resolves.toBeUndefined();
      expect(
        mockDepartmentAccessService.hasDepartmentAccessKey,
      ).not.toHaveBeenCalled();
    });

    it('resolves when the member is a Prayer department worker (checked via DepartmentAccessService)', async () => {
      mockPastorRepo.exists.mockResolvedValue(false);
      mockDepartmentAccessService.hasDepartmentAccessKey.mockResolvedValue(
        true,
      );

      await expect(
        service.assertIsPrayerTeamOrPastor('member-1'),
      ).resolves.toBeUndefined();
      expect(
        mockDepartmentAccessService.hasDepartmentAccessKey,
      ).toHaveBeenCalledWith('member-1', DepartmentKeyEnum.PRAYER);
    });

    it('throws ForbiddenException otherwise', async () => {
      mockPastorRepo.exists.mockResolvedValue(false);
      mockDepartmentAccessService.hasDepartmentAccessKey.mockResolvedValue(
        false,
      );

      await expect(
        service.assertIsPrayerTeamOrPastor('member-1'),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
