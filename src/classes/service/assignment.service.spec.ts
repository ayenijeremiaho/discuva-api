import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AssignmentService } from './assignment.service';
import { Assignment } from '../entity/assignment.entity';
import { AssignmentSubmission } from '../entity/assignment-submission.entity';
import { ChurchClass } from '../entity/church-class.entity';

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
    it('returns published assignments merged with the caller own submission', async () => {
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

      expect(result).toHaveLength(2);
      expect(result[0].mySubmission).toEqual(
        expect.objectContaining({ id: 'sub-1', score: 18 }),
      );
      expect(result[1].mySubmission).toBeNull();
    });

    it('returns an empty array when the class has no published assignments', async () => {
      mockAssignmentRepo.find.mockResolvedValue([]);
      const result = await service.getAvailableForMember('class-1', 'member-1');
      expect(result).toEqual([]);
    });
  });
});
