import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { GameService } from './game.service';
import { Game } from '../entity/game.entity';
import { GameQuestion } from '../entity/game-question.entity';
import { GameSession } from '../entity/game-session.entity';
import { GameParticipant } from '../entity/game-participant.entity';
import { GameResponse } from '../entity/game-response.entity';
import {
  GameSessionStatusEnum,
  GameStatusEnum,
} from '../enum/game-status.enum';
import { AuditLogService } from '../../utility/service/audit-log.service';

const mockAdmin = { id: 'admin-1' } as any;

const mockGameRepo = {
  create: jest.fn(),
  save: jest.fn(),
  remove: jest.fn(),
  findOne: jest.fn(),
  findAndCount: jest.fn(),
};

const mockQuestionRepo = {
  create: jest.fn(),
  save: jest.fn(),
  remove: jest.fn(),
  findOne: jest.fn(),
  find: jest.fn(),
  count: jest.fn(),
  update: jest.fn(),
};

const mockSessionRepo = {
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
};

const mockParticipantRepo = {
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  find: jest.fn(),
  count: jest.fn(),
};

const mockResponseRepo = {
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  count: jest.fn(),
};

const mockAuditLogService = { log: jest.fn() };

describe('GameService', () => {
  let service: GameService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GameService,
        { provide: getRepositoryToken(Game), useValue: mockGameRepo },
        {
          provide: getRepositoryToken(GameQuestion),
          useValue: mockQuestionRepo,
        },
        { provide: getRepositoryToken(GameSession), useValue: mockSessionRepo },
        {
          provide: getRepositoryToken(GameParticipant),
          useValue: mockParticipantRepo,
        },
        {
          provide: getRepositoryToken(GameResponse),
          useValue: mockResponseRepo,
        },
        { provide: AuditLogService, useValue: mockAuditLogService },
      ],
    }).compile();
    service = module.get(GameService);
  });

  describe('createGame', () => {
    it('creates a DRAFT game and logs GAME_CREATED', async () => {
      const saved = { id: 'game-1', title: 'Bible Trivia' };
      mockGameRepo.create.mockReturnValue(saved);
      mockGameRepo.save.mockResolvedValue(saved);

      const result = await service.createGame(
        { title: 'Bible Trivia' } as any,
        mockAdmin,
      );

      expect(mockGameRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Bible Trivia',
          status: GameStatusEnum.DRAFT,
          createdBy: { id: 'admin-1' },
        }),
      );
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'GAME_CREATED',
        expect.objectContaining({ actorId: 'admin-1', targetId: 'game-1' }),
      );
      expect(result).toBe(saved);
    });
  });

  describe('addQuestion', () => {
    it('throws BadRequestException when correctOptionIndex is out of range', async () => {
      mockGameRepo.findOne.mockResolvedValue({ id: 'game-1' });
      await expect(
        service.addQuestion(
          'game-1',
          {
            questionText: 'Q',
            options: ['A', 'B'],
            correctOptionIndex: 2,
          } as any,
          mockAdmin,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('assigns the next order based on existing question count', async () => {
      mockGameRepo.findOne.mockResolvedValue({ id: 'game-1' });
      mockQuestionRepo.count.mockResolvedValue(2);
      const saved = { id: 'q-1' };
      mockQuestionRepo.create.mockReturnValue(saved);
      mockQuestionRepo.save.mockResolvedValue(saved);

      await service.addQuestion(
        'game-1',
        {
          questionText: 'Q',
          options: ['A', 'B'],
          correctOptionIndex: 0,
        } as any,
        mockAdmin,
      );

      expect(mockQuestionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          order: 2,
          points: 1000,
          timeLimitSeconds: 20,
        }),
      );
    });
  });

  describe('startSession', () => {
    it('throws BadRequestException when the game has no questions', async () => {
      mockGameRepo.findOne.mockResolvedValue({ id: 'game-1' });
      mockQuestionRepo.count.mockResolvedValue(0);

      await expect(service.startSession('game-1', mockAdmin)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('creates a LIVE session at question index 0 and flips the game status', async () => {
      const game = { id: 'game-1', status: GameStatusEnum.DRAFT };
      mockGameRepo.findOne.mockResolvedValue(game);
      mockQuestionRepo.count.mockResolvedValue(3);
      const session = { id: 'sess-1', sessionCode: 'GAME-ABC123' };
      mockSessionRepo.create.mockReturnValue(session);
      mockSessionRepo.save.mockResolvedValue(session);
      mockGameRepo.save.mockResolvedValue(game);

      const result = await service.startSession('game-1', mockAdmin);

      expect(mockSessionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: GameSessionStatusEnum.LIVE,
          currentQuestionIndex: 0,
        }),
      );
      expect(game.status).toBe(GameStatusEnum.LIVE_SESSION_ACTIVE);
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'GAME_SESSION_STARTED',
        expect.objectContaining({ actorId: 'admin-1' }),
      );
      expect(result).toBe(session);
    });
  });

  describe('nextQuestion', () => {
    it('throws ForbiddenException when the caller is not the host', async () => {
      mockSessionRepo.findOne.mockResolvedValue({
        id: 'sess-1',
        status: GameSessionStatusEnum.LIVE,
        hostAdmin: { id: 'other-admin' },
        game: { id: 'game-1' },
      });
      await expect(
        service.nextQuestion('GAME-ABC123', mockAdmin),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException when the session is not LIVE', async () => {
      mockSessionRepo.findOne.mockResolvedValue({
        id: 'sess-1',
        status: GameSessionStatusEnum.ENDED,
        hostAdmin: { id: 'admin-1' },
        game: { id: 'game-1' },
      });
      await expect(
        service.nextQuestion('GAME-ABC123', mockAdmin),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when already on the last question', async () => {
      mockSessionRepo.findOne.mockResolvedValue({
        id: 'sess-1',
        status: GameSessionStatusEnum.LIVE,
        hostAdmin: { id: 'admin-1' },
        currentQuestionIndex: 1,
        game: { id: 'game-1' },
      });
      mockQuestionRepo.count.mockResolvedValue(2);

      await expect(
        service.nextQuestion('GAME-ABC123', mockAdmin),
      ).rejects.toThrow(BadRequestException);
    });

    it('advances currentQuestionIndex and resets the question timer', async () => {
      const session = {
        id: 'sess-1',
        sessionCode: 'GAME-ABC123',
        status: GameSessionStatusEnum.LIVE,
        hostAdmin: { id: 'admin-1' },
        currentQuestionIndex: 0,
        currentQuestionStartedAt: new Date(Date.now() - 60_000),
        game: { id: 'game-1' },
      };
      mockSessionRepo.findOne.mockResolvedValue(session);
      mockQuestionRepo.count.mockResolvedValue(2);
      mockSessionRepo.save.mockResolvedValue(session);
      mockQuestionRepo.find.mockResolvedValue([
        {
          id: 'q-1',
          order: 0,
          timeLimitSeconds: 20,
          points: 1000,
          options: [],
          questionText: '',
        },
        {
          id: 'q-2',
          order: 1,
          timeLimitSeconds: 20,
          points: 1000,
          options: [],
          questionText: '',
        },
      ]);
      mockParticipantRepo.count.mockResolvedValue(0);
      mockResponseRepo.count.mockResolvedValue(0);
      mockParticipantRepo.find.mockResolvedValue([]);

      const state = await service.nextQuestion('GAME-ABC123', mockAdmin);

      expect(session.currentQuestionIndex).toBe(1);
      expect(state.currentQuestionIndex).toBe(1);
      expect(state.currentQuestion?.id).toBe('q-2');
      expect(state.currentQuestion).not.toHaveProperty('correctOptionIndex');
    });
  });

  describe('endSession', () => {
    it('marks the session ENDED and reverts the game to DRAFT', async () => {
      const game = { id: 'game-1', status: GameStatusEnum.LIVE_SESSION_ACTIVE };
      const session = {
        id: 'sess-1',
        sessionCode: 'GAME-ABC123',
        status: GameSessionStatusEnum.LIVE,
        hostAdmin: { id: 'admin-1' },
        currentQuestionIndex: 0,
        game,
      };
      mockSessionRepo.findOne.mockResolvedValue(session);
      mockSessionRepo.save.mockResolvedValue(session);
      mockGameRepo.save.mockResolvedValue(game);
      mockQuestionRepo.find.mockResolvedValue([]);
      mockParticipantRepo.count.mockResolvedValue(0);
      mockResponseRepo.count.mockResolvedValue(0);
      mockParticipantRepo.find.mockResolvedValue([]);

      await service.endSession('GAME-ABC123', mockAdmin);

      expect(session.status).toBe(GameSessionStatusEnum.ENDED);
      expect(game.status).toBe(GameStatusEnum.DRAFT);
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'GAME_SESSION_ENDED',
        expect.objectContaining({ actorId: 'admin-1' }),
      );
    });

    it('is idempotent — calling twice only logs once', async () => {
      const game = { id: 'game-1', status: GameStatusEnum.DRAFT };
      const session = {
        id: 'sess-1',
        sessionCode: 'GAME-ABC123',
        status: GameSessionStatusEnum.ENDED,
        hostAdmin: { id: 'admin-1' },
        currentQuestionIndex: 0,
        game,
      };
      mockSessionRepo.findOne.mockResolvedValue(session);
      mockQuestionRepo.find.mockResolvedValue([]);
      mockParticipantRepo.count.mockResolvedValue(0);
      mockResponseRepo.count.mockResolvedValue(0);
      mockParticipantRepo.find.mockResolvedValue([]);

      await service.endSession('GAME-ABC123', mockAdmin);

      expect(mockSessionRepo.save).not.toHaveBeenCalled();
      expect(mockAuditLogService.log).not.toHaveBeenCalled();
    });
  });

  describe('joinSession', () => {
    it('throws BadRequestException when the session is not LIVE', async () => {
      mockSessionRepo.findOne.mockResolvedValue({
        id: 'sess-1',
        status: GameSessionStatusEnum.SCHEDULED,
      });
      await expect(
        service.joinSession('GAME-ABC123', 'member-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates a new participant when none exists', async () => {
      mockSessionRepo.findOne.mockResolvedValue({
        id: 'sess-1',
        status: GameSessionStatusEnum.LIVE,
      });
      mockParticipantRepo.findOne.mockResolvedValue(null);
      const participant = { id: 'part-1' };
      mockParticipantRepo.create.mockReturnValue(participant);
      mockParticipantRepo.save.mockResolvedValue(participant);

      const result = await service.joinSession('GAME-ABC123', 'member-1');

      expect(result).toEqual({ participantId: 'part-1' });
    });

    it('returns the existing participant without creating a duplicate', async () => {
      mockSessionRepo.findOne.mockResolvedValue({
        id: 'sess-1',
        status: GameSessionStatusEnum.LIVE,
      });
      mockParticipantRepo.findOne.mockResolvedValue({ id: 'part-existing' });

      const result = await service.joinSession('GAME-ABC123', 'member-1');

      expect(mockParticipantRepo.create).not.toHaveBeenCalled();
      expect(result).toEqual({ participantId: 'part-existing' });
    });
  });

  describe('submitAnswer', () => {
    const currentQuestion = {
      id: 'q-1',
      order: 0,
      correctOptionIndex: 1,
      points: 1000,
      timeLimitSeconds: 20,
      options: ['A', 'B'],
      questionText: 'Q',
    };

    function mockLiveSession(overrides: Partial<any> = {}) {
      mockSessionRepo.findOne.mockResolvedValue({
        id: 'sess-1',
        status: GameSessionStatusEnum.LIVE,
        currentQuestionIndex: 0,
        currentQuestionStartedAt: new Date(),
        game: { id: 'game-1' },
        ...overrides,
      });
      mockQuestionRepo.find.mockResolvedValue([currentQuestion]);
    }

    it('throws BadRequestException when the session is not LIVE', async () => {
      mockSessionRepo.findOne.mockResolvedValue({
        id: 'sess-1',
        status: GameSessionStatusEnum.ENDED,
      });
      await expect(
        service.submitAnswer('GAME-ABC123', 'q-1', 'member-1', {
          selectedOptionIndex: 1,
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when answering a non-current question', async () => {
      mockLiveSession();
      await expect(
        service.submitAnswer('GAME-ABC123', 'q-wrong', 'member-1', {
          selectedOptionIndex: 1,
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ForbiddenException when the caller never joined the session', async () => {
      mockLiveSession();
      mockParticipantRepo.findOne.mockResolvedValue(null);
      await expect(
        service.submitAnswer('GAME-ABC123', 'q-1', 'member-1', {
          selectedOptionIndex: 1,
        } as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException on a duplicate answer', async () => {
      mockLiveSession();
      mockParticipantRepo.findOne.mockResolvedValue({
        id: 'part-1',
        totalScore: 0,
      });
      mockResponseRepo.findOne.mockResolvedValue({ id: 'existing-response' });
      await expect(
        service.submitAnswer('GAME-ABC123', 'q-1', 'member-1', {
          selectedOptionIndex: 1,
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('awards 0 points for an incorrect answer', async () => {
      mockLiveSession();
      const participant = { id: 'part-1', totalScore: 0 };
      mockParticipantRepo.findOne.mockResolvedValue(participant);
      mockResponseRepo.findOne.mockResolvedValue(null);
      mockResponseRepo.create.mockImplementation((v) => v);
      mockResponseRepo.save.mockResolvedValue({});

      const result = await service.submitAnswer(
        'GAME-ABC123',
        'q-1',
        'member-1',
        {
          selectedOptionIndex: 0,
        } as any,
      );

      expect(result).toEqual({ isCorrect: false, pointsAwarded: 0 });
      expect(mockParticipantRepo.save).not.toHaveBeenCalled();
    });

    it('awards full points for an instant correct answer', async () => {
      mockLiveSession({ currentQuestionStartedAt: new Date() });
      const participant = { id: 'part-1', totalScore: 0 };
      mockParticipantRepo.findOne.mockResolvedValue(participant);
      mockResponseRepo.findOne.mockResolvedValue(null);
      mockResponseRepo.create.mockImplementation((v) => v);
      mockResponseRepo.save.mockResolvedValue({});

      const result = await service.submitAnswer(
        'GAME-ABC123',
        'q-1',
        'member-1',
        {
          selectedOptionIndex: 1,
        } as any,
      );

      expect(result.isCorrect).toBe(true);
      expect(result.pointsAwarded).toBe(1000);
      expect(participant.totalScore).toBe(1000);
      expect(mockParticipantRepo.save).toHaveBeenCalledWith(participant);
    });

    it('floors the speed bonus at 50% of base points for a correct answer submitted near the deadline', async () => {
      const startedAt = new Date(Date.now() - 19_000); // 19s elapsed of a 20s window
      mockLiveSession({ currentQuestionStartedAt: startedAt });
      const participant = { id: 'part-1', totalScore: 0 };
      mockParticipantRepo.findOne.mockResolvedValue(participant);
      mockResponseRepo.findOne.mockResolvedValue(null);
      mockResponseRepo.create.mockImplementation((v) => v);
      mockResponseRepo.save.mockResolvedValue({});

      const result = await service.submitAnswer(
        'GAME-ABC123',
        'q-1',
        'member-1',
        {
          selectedOptionIndex: 1,
        } as any,
      );

      expect(result.isCorrect).toBe(true);
      expect(result.pointsAwarded).toBe(500);
    });
  });

  describe('getLeaderboard', () => {
    it('returns participants ordered by totalScore desc with member names', async () => {
      mockSessionRepo.findOne.mockResolvedValue({ id: 'sess-1' });
      mockParticipantRepo.find.mockResolvedValue([
        {
          id: 'part-1',
          totalScore: 1500,
          member: { id: 'm-1', firstname: 'Ada', lastname: 'Lovelace' },
        },
      ]);

      const result = await service.getLeaderboard('GAME-ABC123');

      expect(result).toEqual([
        {
          participantId: 'part-1',
          memberId: 'm-1',
          memberName: 'Ada Lovelace',
          totalScore: 1500,
        },
      ]);
    });
  });
});
