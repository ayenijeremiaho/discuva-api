import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PastorFeedbackService } from './pastor-feedback.service';
import { PastorFeedback } from '../entity/pastor-feedback.entity';
import { DepartmentLead } from '../../department/entity/department-lead.entity';
import { WorkerProfile } from '../../member/entity/worker-profile.entity';
import { Pastor } from '../../member/entity/pastor.entity';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { UtilityService } from '../../utility/service/utility.service';
import { PushNotificationService } from '../../push-notification/service/push-notification.service';
import { MemberAuth } from '../../auth/interface/auth.interface';
import { MemberRoleEnum } from '../../member/enums/member-role.enum';
import { SessionSurface } from '../../auth/enum/session-surface.enum';

const mockFeedbackRepo = {
  findOne: jest.fn(),
  findAndCount: jest.fn(),
  save: jest.fn(),
  create: jest.fn(),
  remove: jest.fn(),
};

const mockLeadRepo = {
  exists: jest.fn(),
};

const mockWorkerProfileRepo = {
  findOne: jest.fn(),
};

const mockPastorRepo = {
  findOne: jest.fn(),
  exists: jest.fn(),
};

const mockAuditLogService = { log: jest.fn() };

const mockUtilityService = {
  sendEmailWithTemplate: jest.fn(),
};

const mockPushService = {
  dispatchToMemberIds: jest.fn(),
};

const currentUser: MemberAuth = {
  id: 'member-1',
  role: MemberRoleEnum.WORKER,
  requiresPasswordChange: false,
  surface: SessionSurface.MEMBER,
  workerProfileId: 'wp-1',
};

describe('PastorFeedbackService', () => {
  let service: PastorFeedbackService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PastorFeedbackService,
        {
          provide: getRepositoryToken(PastorFeedback),
          useValue: mockFeedbackRepo,
        },
        { provide: getRepositoryToken(DepartmentLead), useValue: mockLeadRepo },
        {
          provide: getRepositoryToken(WorkerProfile),
          useValue: mockWorkerProfileRepo,
        },
        { provide: getRepositoryToken(Pastor), useValue: mockPastorRepo },
        { provide: AuditLogService, useValue: mockAuditLogService },
        { provide: UtilityService, useValue: mockUtilityService },
        { provide: PushNotificationService, useValue: mockPushService },
      ],
    }).compile();

    service = module.get<PastorFeedbackService>(PastorFeedbackService);
  });

  describe('submitFeedback', () => {
    const dto = {
      departmentId: 'dept-1',
      weekOf: '2026-07-13',
      attendanceNotes: 'Good turnout',
      highlights: 'New members joined',
      challenges: 'Sound system issues',
    };

    it('throws ForbiddenException if caller has no workerProfileId', async () => {
      await expect(
        service.submitFeedback(dto, {
          ...currentUser,
          workerProfileId: undefined,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException if caller is not HOD/D_HOD of the department', async () => {
      mockLeadRepo.exists.mockResolvedValue(false);

      await expect(service.submitFeedback(dto, currentUser)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('creates feedback when caller is the department lead', async () => {
      mockLeadRepo.exists.mockResolvedValue(true);
      mockWorkerProfileRepo.findOne.mockResolvedValue({
        id: 'wp-1',
        member: { firstname: 'Ada', lastname: 'Lovelace' },
      });
      const created = { id: 'fb-1', ...dto };
      mockFeedbackRepo.create.mockReturnValue(created);
      mockFeedbackRepo.save.mockResolvedValue(created);

      const result = await service.submitFeedback(dto, currentUser);

      expect(mockFeedbackRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          submittedByName: 'Ada Lovelace',
          weekOf: dto.weekOf,
        }),
      );
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'PASTOR_FEEDBACK_SUBMITTED',
        expect.objectContaining({ actorId: 'member-1' }),
      );
      expect(result).toEqual(created);
    });

    it('throws ConflictException on duplicate (department, weekOf) submission', async () => {
      mockLeadRepo.exists.mockResolvedValue(true);
      mockWorkerProfileRepo.findOne.mockResolvedValue({
        id: 'wp-1',
        member: { firstname: 'Ada', lastname: 'Lovelace' },
      });
      mockFeedbackRepo.create.mockReturnValue({});
      mockFeedbackRepo.save.mockRejectedValue({ code: '23505' });

      await expect(service.submitFeedback(dto, currentUser)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('updateOwnFeedback', () => {
    it('throws NotFoundException if feedback does not exist', async () => {
      mockFeedbackRepo.findOne.mockResolvedValue(null);

      await expect(
        service.updateOwnFeedback('missing', {}, currentUser),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException if caller did not submit this feedback', async () => {
      mockFeedbackRepo.findOne.mockResolvedValue({
        id: 'fb-1',
        submittedBy: { id: 'wp-other' },
        department: { id: 'dept-1' },
      });

      await expect(
        service.updateOwnFeedback('fb-1', { highlights: 'x' }, currentUser),
      ).rejects.toThrow(ForbiddenException);
    });

    it('updates fields when caller is the submitter', async () => {
      const feedback = {
        id: 'fb-1',
        submittedBy: { id: 'wp-1' },
        department: { id: 'dept-1' },
        highlights: 'old',
      };
      mockFeedbackRepo.findOne.mockResolvedValue(feedback);
      mockFeedbackRepo.save.mockImplementation((f) => Promise.resolve(f));

      const result = await service.updateOwnFeedback(
        'fb-1',
        { highlights: 'new' },
        currentUser,
      );

      expect(result.highlights).toBe('new');
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'PASTOR_FEEDBACK_UPDATED',
        expect.objectContaining({ actorId: 'member-1' }),
      );
    });
  });

  describe('respondAsPastor', () => {
    it('throws ForbiddenException if caller has no Pastor record', async () => {
      mockPastorRepo.findOne.mockResolvedValue(null);

      await expect(
        service.respondAsPastor('fb-1', { response: 'Well done' }, 'member-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('saves the response, logs, and notifies the submitter', async () => {
      mockPastorRepo.findOne.mockResolvedValue({
        id: 'pastor-1',
        member: { id: 'pastor-member-1', firstname: 'John', lastname: 'Doe' },
      });
      const feedback = {
        id: 'fb-1',
        department: { id: 'dept-1', name: 'Media' },
        submittedBy: {
          member: {
            id: 'member-1',
            email: 'hod@example.com',
            firstname: 'Ada',
          },
        },
        weekOf: '2026-07-13',
      };
      mockFeedbackRepo.findOne.mockResolvedValue(feedback);
      mockFeedbackRepo.save.mockImplementation((f) => Promise.resolve(f));

      const result = await service.respondAsPastor(
        'fb-1',
        { response: 'Great work this week' },
        'pastor-member-1',
      );

      expect(result.pastorResponse).toBe('Great work this week');
      expect(result.respondedByPastorName).toBe('John Doe');
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'PASTOR_FEEDBACK_RESPONDED',
        expect.objectContaining({ actorId: 'pastor-member-1' }),
      );
      expect(mockUtilityService.sendEmailWithTemplate).toHaveBeenCalled();
      expect(mockPushService.dispatchToMemberIds).toHaveBeenCalledWith(
        ['member-1'],
        expect.objectContaining({
          idempotencyKey: 'pastor-feedback-response:fb-1',
        }),
      );
    });
  });

  describe('getMySubmissions', () => {
    it('returns an empty page when the caller has no workerProfileId', async () => {
      const result = await service.getMySubmissions({
        ...currentUser,
        workerProfileId: undefined,
      });

      expect(result.data).toEqual([]);
      expect(mockFeedbackRepo.findAndCount).not.toHaveBeenCalled();
    });

    it("returns the caller's submissions", async () => {
      mockFeedbackRepo.findAndCount.mockResolvedValue([[{ id: 'fb-1' }], 1]);

      const result = await service.getMySubmissions(currentUser, 1, 10);

      expect(result.data).toHaveLength(1);
      expect(mockFeedbackRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { submittedBy: { id: 'wp-1' } },
        }),
      );
    });
  });

  describe('assertIsPastor', () => {
    it('throws ForbiddenException when no Pastor record exists', async () => {
      mockPastorRepo.exists.mockResolvedValue(false);

      await expect(service.assertIsPastor('member-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('resolves without throwing when a Pastor record exists', async () => {
      mockPastorRepo.exists.mockResolvedValue(true);

      await expect(service.assertIsPastor('member-1')).resolves.toBeUndefined();
    });
  });
});
