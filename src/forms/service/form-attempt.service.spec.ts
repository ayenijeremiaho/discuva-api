import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { FormAttemptService } from './form-attempt.service';
import { Form } from '../entity/form.entity';
import { FormAttempt } from '../entity/form-attempt.entity';
import { FormPurpose } from '../enum/form.enum';

const mockFormRepo = {
  findOne: jest.fn(),
};
const mockAttemptRepo = {
  create: jest.fn((v) => v),
  save: jest.fn((v) => Promise.resolve({ id: 'attempt-1', ...v })),
  findOne: jest.fn(),
};

describe('FormAttemptService', () => {
  let service: FormAttemptService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FormAttemptService,
        { provide: getRepositoryToken(Form), useValue: mockFormRepo },
        { provide: getRepositoryToken(FormAttempt), useValue: mockAttemptRepo },
      ],
    }).compile();
    service = module.get(FormAttemptService);
  });

  const timedQuiz = {
    id: 'form-1',
    purpose: FormPurpose.QUIZ,
    timeLimitMinutes: 10,
    oneResponsePerMember: true,
    opensAt: null,
    closesAt: null,
  } as Form;

  describe('startOrGetAttempt', () => {
    it('starts a fresh attempt when none exists', async () => {
      mockAttemptRepo.findOne.mockResolvedValue(null);
      const result = await service.startOrGetAttempt(timedQuiz, 'member-1');
      expect(mockAttemptRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          form: { id: 'form-1' },
          member: { id: 'member-1' },
          submission: null,
        }),
      );
      const expectedMs = result.startedAt.getTime() + 10 * 60_000;
      expect(result.expiresAt.getTime()).toBe(expectedMs);
    });

    it('returns the same in-progress attempt on a second call (idempotent)', async () => {
      const startedAt = new Date();
      const expiresAt = new Date(startedAt.getTime() + 10 * 60_000);
      mockAttemptRepo.findOne.mockResolvedValue({
        id: 'attempt-1',
        startedAt,
        expiresAt,
        submission: null,
      });
      const result = await service.startOrGetAttempt(timedQuiz, 'member-1');
      expect(result.startedAt).toBe(startedAt);
      expect(result.expiresAt).toBe(expiresAt);
      expect(mockAttemptRepo.save).not.toHaveBeenCalled();
    });

    it('rejects a new attempt when one was already completed and retakes are disallowed', async () => {
      mockAttemptRepo.findOne.mockResolvedValue({
        id: 'attempt-1',
        startedAt: new Date(Date.now() - 20 * 60_000),
        expiresAt: new Date(Date.now() - 10 * 60_000),
        submission: { id: 'sub-1' },
      });
      await expect(
        service.startOrGetAttempt(timedQuiz, 'member-1'),
      ).rejects.toThrow(BadRequestException);
      expect(mockAttemptRepo.save).not.toHaveBeenCalled();
    });

    it('allows a fresh attempt after completion when retakes are allowed', async () => {
      mockAttemptRepo.findOne.mockResolvedValue({
        id: 'attempt-1',
        startedAt: new Date(Date.now() - 20 * 60_000),
        expiresAt: new Date(Date.now() - 10 * 60_000),
        submission: { id: 'sub-1' },
      });
      const retakeAllowed = { ...timedQuiz, oneResponsePerMember: false };
      const result = await service.startOrGetAttempt(retakeAllowed, 'member-1');
      expect(mockAttemptRepo.save).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('allows a fresh attempt after the previous one expired unconsumed, when retakes are allowed', async () => {
      mockAttemptRepo.findOne.mockResolvedValue({
        id: 'attempt-1',
        startedAt: new Date(Date.now() - 20 * 60_000),
        expiresAt: new Date(Date.now() - 10 * 60_000),
        submission: null,
      });
      const retakeAllowed = { ...timedQuiz, oneResponsePerMember: false };
      await service.startOrGetAttempt(retakeAllowed, 'member-1');
      expect(mockAttemptRepo.save).toHaveBeenCalled();
    });

    it('clamps expiresAt to the form closesAt when the timer would run past it', async () => {
      mockAttemptRepo.findOne.mockResolvedValue(null);
      const closesAt = new Date(Date.now() + 5 * 60_000); // closes in 5 min
      const result = await service.startOrGetAttempt(
        { ...timedQuiz, closesAt },
        'member-1',
      );
      expect(result.expiresAt).toEqual(closesAt);
    });

    it('rejects starting before opensAt', async () => {
      mockAttemptRepo.findOne.mockResolvedValue(null);
      await expect(
        service.startOrGetAttempt(
          { ...timedQuiz, opensAt: new Date(Date.now() + 60_000) },
          'member-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects starting after closesAt', async () => {
      mockAttemptRepo.findOne.mockResolvedValue(null);
      await expect(
        service.startOrGetAttempt(
          { ...timedQuiz, closesAt: new Date(Date.now() - 60_000) },
          'member-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('assertValidForSubmit', () => {
    it('rejects when no attempt exists', async () => {
      mockAttemptRepo.findOne.mockResolvedValue(null);
      await expect(
        service.assertValidForSubmit(timedQuiz, 'member-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects when the attempt is already consumed', async () => {
      mockAttemptRepo.findOne.mockResolvedValue({
        id: 'attempt-1',
        expiresAt: new Date(Date.now() + 60_000),
        submission: { id: 'sub-1' },
      });
      await expect(
        service.assertValidForSubmit(timedQuiz, 'member-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects when the attempt has expired', async () => {
      mockAttemptRepo.findOne.mockResolvedValue({
        id: 'attempt-1',
        expiresAt: new Date(Date.now() - 60_000),
        submission: null,
      });
      await expect(
        service.assertValidForSubmit(timedQuiz, 'member-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('returns the attempt when valid and unexpired', async () => {
      const attempt = {
        id: 'attempt-1',
        expiresAt: new Date(Date.now() + 60_000),
        submission: null,
      };
      mockAttemptRepo.findOne.mockResolvedValue(attempt);
      const result = await service.assertValidForSubmit(timedQuiz, 'member-1');
      expect(result).toBe(attempt);
    });
  });

  describe('startOrGetAttemptById', () => {
    it('throws NotFoundException when the form does not exist', async () => {
      mockFormRepo.findOne.mockResolvedValue(null);
      await expect(
        service.startOrGetAttemptById('form-1', 'member-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects a non-QUIZ or untimed form', async () => {
      mockFormRepo.findOne.mockResolvedValue({
        ...timedQuiz,
        timeLimitMinutes: null,
      });
      await expect(
        service.startOrGetAttemptById('form-1', 'member-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
