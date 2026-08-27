import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AssignmentService } from './assignment.service';
import { Assignment } from '../entity/assignment.entity';
import { AssignmentSubmission } from '../entity/assignment-submission.entity';
import { ChurchClass } from '../entity/church-class.entity';
import { ClassEnrollment } from '../entity/class-enrollment.entity';

const mockAssignmentRepo = {
  find: jest.fn(),
  findOne: jest.fn(),
  findOneBy: jest.fn(),
  save: jest.fn(),
  create: jest.fn((v) => v),
  remove: jest.fn(),
};

const mockSubmissionRepo = {
  find: jest.fn(),
  findOne: jest.fn(),
  findAndCount: jest.fn(),
  save: jest.fn(),
  create: jest.fn((v) => v),
  createQueryBuilder: jest.fn(),
};

const mockClassRepo = {
  findOneBy: jest.fn(),
};

const mockEnrollmentRepo = {
  findOne: jest.fn(),
};

describe('AssignmentService', () => {
  let service: AssignmentService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssignmentService,
        {
          provide: getRepositoryToken(Assignment),
          useValue: mockAssignmentRepo,
        },
        {
          provide: getRepositoryToken(AssignmentSubmission),
          useValue: mockSubmissionRepo,
        },
        { provide: getRepositoryToken(ChurchClass), useValue: mockClassRepo },
        {
          provide: getRepositoryToken(ClassEnrollment),
          useValue: mockEnrollmentRepo,
        },
      ],
    }).compile();
    service = module.get(AssignmentService);
  });

  describe('create', () => {
    it('creates an assignment for an existing class', async () => {
      mockClassRepo.findOneBy.mockResolvedValue({
        id: 'class-1',
        name: 'Water Baptism',
      });
      mockAssignmentRepo.save.mockImplementation((a) =>
        Promise.resolve({ id: 'assign-1', ...a }),
      );

      const result = await service.create('class-1', {
        title: 'Chapter 1 Quiz',
        maxScore: 20,
      });

      expect(mockAssignmentRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Chapter 1 Quiz',
          maxScore: 20,
          isPublished: true,
        }),
      );
      expect(result.id).toBe('assign-1');
    });

    it('throws NotFoundException for an unknown class', async () => {
      mockClassRepo.findOneBy.mockResolvedValue(null);
      await expect(service.create('missing', { title: 'x' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('submit', () => {
    it('creates a new submission when none exists', async () => {
      mockAssignmentRepo.findOneBy.mockResolvedValue({
        id: 'assign-1',
        isPublished: true,
      });
      mockSubmissionRepo.findOne.mockResolvedValue(null);
      mockSubmissionRepo.save.mockImplementation((s) =>
        Promise.resolve({ id: 'sub-1', ...s }),
      );

      const result = await service.submit('assign-1', 'member-1', {
        content: 'My answer',
      });

      expect(mockSubmissionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'My answer' }),
      );
      expect(result.id).toBe('sub-1');
    });

    it('overwrites an ungraded existing submission (resubmission)', async () => {
      mockAssignmentRepo.findOneBy.mockResolvedValue({
        id: 'assign-1',
        isPublished: true,
      });
      const existing = {
        id: 'sub-1',
        content: 'Old answer',
        submittedAt: new Date('2026-01-01'),
        gradedAt: null,
      };
      mockSubmissionRepo.findOne.mockResolvedValue(existing);
      mockSubmissionRepo.save.mockImplementation((s) => Promise.resolve(s));

      const result = await service.submit('assign-1', 'member-1', {
        content: 'New answer',
      });

      expect(result.content).toBe('New answer');
    });

    it('rejects resubmission once already graded', async () => {
      mockAssignmentRepo.findOneBy.mockResolvedValue({
        id: 'assign-1',
        isPublished: true,
      });
      mockSubmissionRepo.findOne.mockResolvedValue({
        id: 'sub-1',
        gradedAt: new Date('2026-01-02'),
      });

      await expect(
        service.submit('assign-1', 'member-1', { content: 'Too late' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects submission to an unpublished assignment', async () => {
      mockAssignmentRepo.findOneBy.mockResolvedValue({
        id: 'assign-1',
        isPublished: false,
      });

      await expect(
        service.submit('assign-1', 'member-1', { content: 'Too early' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException for an unknown assignment', async () => {
      mockAssignmentRepo.findOneBy.mockResolvedValue(null);
      await expect(
        service.submit('missing', 'member-1', { content: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('grade', () => {
    it('scores a submission and stamps who graded it', async () => {
      mockSubmissionRepo.findOne.mockResolvedValue({
        id: 'sub-1',
        assignment: { id: 'assign-1', maxScore: 20 },
        member: { id: 'member-1' },
      });
      mockSubmissionRepo.save.mockImplementation((s) => Promise.resolve(s));

      const result = await service.grade(
        'sub-1',
        { score: 18, feedback: 'Great work' },
        'admin-1',
      );

      expect(result.score).toBe(18);
      expect(result.feedback).toBe('Great work');
      expect(result.gradedBy).toEqual({ id: 'admin-1' });
      expect(result.gradedAt).toBeInstanceOf(Date);
    });

    it('rejects a score above the assignment max', async () => {
      mockSubmissionRepo.findOne.mockResolvedValue({
        id: 'sub-1',
        assignment: { id: 'assign-1', maxScore: 20 },
        member: { id: 'member-1' },
      });

      await expect(
        service.grade('sub-1', { score: 25 }, 'admin-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException for an unknown submission', async () => {
      mockSubmissionRepo.findOne.mockResolvedValue(null);
      await expect(
        service.grade('missing', { score: 10 }, 'admin-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getAvailableForMember', () => {
    it('returns published assignments merged with the caller own submission, plus a progress summary', async () => {
      mockAssignmentRepo.find.mockResolvedValue([
        { id: 'assign-1', title: 'Quiz 1', isPublished: true },
        { id: 'assign-2', title: 'Quiz 2', isPublished: true },
      ]);
      const qb = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest
          .fn()
          .mockResolvedValue([
            { id: 'sub-1', assignment: { id: 'assign-1' }, score: 18 },
          ]),
      };
      mockSubmissionRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getAvailableForMember('class-1', 'member-1');

      expect(result.assignments).toHaveLength(2);
      expect(result.assignments[0].mySubmission).toEqual(
        expect.objectContaining({ id: 'sub-1', score: 18 }),
      );
      expect(result.assignments[1].mySubmission).toBeNull();
      expect(result.progress).toEqual({ submitted: 1, total: 2 });
    });

    it('returns an empty assignment list and zeroed progress when the class has no published assignments', async () => {
      mockAssignmentRepo.find.mockResolvedValue([]);
      const result = await service.getAvailableForMember('class-1', 'member-1');
      expect(result).toEqual({
        assignments: [],
        progress: { submitted: 0, total: 0 },
      });
    });
  });

  describe('getForGuestEnrollment', () => {
    it('scopes submissions by class_enrollment_id instead of member_id', async () => {
      mockAssignmentRepo.find.mockResolvedValue([
        { id: 'assign-1', title: 'Quiz 1', isPublished: true },
      ]);
      const qb = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest
          .fn()
          .mockResolvedValue([{ id: 'sub-1', assignment: { id: 'assign-1' } }]),
      };
      mockSubmissionRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getForGuestEnrollment('class-1', 'enroll-1');

      expect(qb.where).toHaveBeenCalledWith(
        's.class_enrollment_id = :enrollmentId',
        {
          enrollmentId: 'enroll-1',
        },
      );
      expect(result.progress).toEqual({ submitted: 1, total: 1 });
    });
  });

  describe('submitAsGuest', () => {
    it('throws NotFoundException when the enrollment has no guest attached', async () => {
      mockAssignmentRepo.findOneBy.mockResolvedValue({
        id: 'assign-1',
        isPublished: true,
        churchClass: { id: 'class-1' },
      });
      mockEnrollmentRepo.findOne.mockResolvedValue({
        id: 'enroll-1',
        guest: null,
        churchClass: { id: 'class-1' },
      });

      await expect(
        service.submitAsGuest('assign-1', 'enroll-1', { content: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when the enrollment belongs to a different class', async () => {
      mockAssignmentRepo.findOneBy.mockResolvedValue({
        id: 'assign-1',
        isPublished: true,
        churchClass: { id: 'class-1' },
      });
      mockEnrollmentRepo.findOne.mockResolvedValue({
        id: 'enroll-1',
        guest: { id: 'guest-1' },
        churchClass: { id: 'class-2' },
      });

      await expect(
        service.submitAsGuest('assign-1', 'enroll-1', { content: 'x' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates a new submission keyed by classEnrollment when none exists', async () => {
      mockAssignmentRepo.findOneBy.mockResolvedValue({
        id: 'assign-1',
        isPublished: true,
        churchClass: { id: 'class-1' },
      });
      mockEnrollmentRepo.findOne.mockResolvedValue({
        id: 'enroll-1',
        guest: { id: 'guest-1' },
        churchClass: { id: 'class-1' },
      });
      mockSubmissionRepo.findOne.mockResolvedValue(null);
      mockSubmissionRepo.save.mockImplementation((s) =>
        Promise.resolve({ id: 'sub-1', ...s }),
      );

      const result = await service.submitAsGuest('assign-1', 'enroll-1', {
        content: 'Guest answer',
      });

      expect(mockSubmissionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Guest answer',
          classEnrollment: { id: 'enroll-1' },
        }),
      );
      expect(result.id).toBe('sub-1');
    });

    it('rejects resubmission once already graded', async () => {
      mockAssignmentRepo.findOneBy.mockResolvedValue({
        id: 'assign-1',
        isPublished: true,
        churchClass: { id: 'class-1' },
      });
      mockEnrollmentRepo.findOne.mockResolvedValue({
        id: 'enroll-1',
        guest: { id: 'guest-1' },
        churchClass: { id: 'class-1' },
      });
      mockSubmissionRepo.findOne.mockResolvedValue({
        id: 'sub-1',
        gradedAt: new Date('2026-01-02'),
      });

      await expect(
        service.submitAsGuest('assign-1', 'enroll-1', { content: 'Too late' }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
