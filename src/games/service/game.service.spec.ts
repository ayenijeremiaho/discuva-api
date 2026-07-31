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
  find: jest.fn(),
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

    it('throws BadRequestException when a live session already exists for the game', async () => {
      mockGameRepo.findOne.mockResolvedValue({ id: 'game-1' });
      mockQuestionRepo.count.mockResolvedValue(3);
      mockSessionRepo.findOne.mockResolvedValue({
        id: 'sess-existing',
        sessionCode: 'GAME-OLD123',
      });

      await expect(service.startSession('game-1', mockAdmin)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockSessionRepo.create).not.toHaveBeenCalled();
    });

    it('creates a LIVE session at question index 0 and flips the game status', async () => {
      const game = { id: 'game-1', status: GameStatusEnum.DRAFT };
      mockGameRepo.findOne.mockResolvedValue(game);
      mockQuestionRepo.count.mockResolvedValue(3);
      mockSessionRepo.findOne.mockResolvedValue(null);
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
        game: { id: 'game-1', title: 'Bible Trivia' },
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
      // Clients tick their own countdown off this timestamp rather than the
      // secondsRemaining snapshot, which goes stale between broadcasts.
      expect(state.currentQuestionStartedAt).toBe(
        session.currentQuestionStartedAt.getTime(),
      );
      expect(state.gameTitle).toBe('Bible Trivia');
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
      // First call is getSessionOrThrow fetching the session itself; second
      // is the "any other session still LIVE?" check — must return null so
      // the DRAFT reset actually runs.
      mockSessionRepo.findOne
        .mockResolvedValueOnce(session)
        .mockResolvedValueOnce(null);
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

    it('does not reset the game to DRAFT if another session is still LIVE', async () => {
      const game = { id: 'game-1', status: GameStatusEnum.LIVE_SESSION_ACTIVE };
      const session = {
        id: 'sess-1',
        sessionCode: 'GAME-ABC123',
        status: GameSessionStatusEnum.LIVE,
        hostAdmin: { id: 'admin-1' },
        currentQuestionIndex: 0,
        game,
      };
      const otherLiveSession = { id: 'sess-2', sessionCode: 'GAME-OTHER99' };
      mockSessionRepo.findOne
        .mockResolvedValueOnce(session)
        .mockResolvedValueOnce(otherLiveSession);
      mockSessionRepo.save.mockResolvedValue(session);
      mockQuestionRepo.find.mockResolvedValue([]);
      mockParticipantRepo.count.mockResolvedValue(0);
      mockResponseRepo.count.mockResolvedValue(0);
      mockParticipantRepo.find.mockResolvedValue([]);

      await service.endSession('GAME-ABC123', mockAdmin);

      expect(session.status).toBe(GameSessionStatusEnum.ENDED);
      expect(game.status).toBe(GameStatusEnum.LIVE_SESSION_ACTIVE);
      expect(mockGameRepo.save).not.toHaveBeenCalled();
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

    it('throws BadRequestException (not a raw 500) when a concurrent double-submit races past the duplicate check', async () => {
      mockLiveSession();
      mockParticipantRepo.findOne.mockResolvedValue({
        id: 'part-1',
        totalScore: 0,
      });
      mockResponseRepo.findOne.mockResolvedValue(null);
      mockResponseRepo.create.mockImplementation((v) => v);
      mockResponseRepo.save.mockRejectedValue({ code: '23505' });

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
      // Date.now() pinned so elapsed time is exactly 0 regardless of how
      // long the test itself takes to run — computeScore reads real wall
      // time, so without this the assertion is flaky under load.
      const now = Date.now();
      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
      mockLiveSession({ currentQuestionStartedAt: new Date(now) });
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
      nowSpy.mockRestore();

      expect(result.isCorrect).toBe(true);
      expect(result.pointsAwarded).toBe(1000);
      expect(participant.totalScore).toBe(1000);
      expect(mockParticipantRepo.save).toHaveBeenCalledWith(participant);
    });

    it('floors the speed bonus at 50% of base points for a correct answer submitted near the deadline', async () => {
      const now = Date.now();
      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
      const startedAt = new Date(now - 19_000); // 19s elapsed of a 20s window
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
      nowSpy.mockRestore();

      expect(result.isCorrect).toBe(true);
      expect(result.pointsAwarded).toBe(500);
    });
  });

  describe('listGames', () => {
    it('attaches the live session code to whichever games actually have one', async () => {
      const liveGame = {
        id: 'game-1',
        status: GameStatusEnum.LIVE_SESSION_ACTIVE,
      };
      const draftGame = { id: 'game-2', status: GameStatusEnum.DRAFT };
      mockGameRepo.findAndCount.mockResolvedValue([[liveGame, draftGame], 2]);
      mockSessionRepo.find.mockResolvedValue([
        {
          sessionCode: 'GAME-LIVE01',
          game: { id: 'game-1' },
        },
      ]);

      const result = await service.listGames(1, 20);

      expect(mockSessionRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: GameSessionStatusEnum.LIVE,
          }),
        }),
      );
      expect(result.data).toEqual([
        expect.objectContaining({
          id: 'game-1',
          activeSessionCode: 'GAME-LIVE01',
        }),
        expect.objectContaining({ id: 'game-2', activeSessionCode: null }),
      ]);
    });

    it('finds a live session even for a game whose own status wrongly says DRAFT', async () => {
      // Regression coverage: Game.status is a denormalized mirror of "is
      // there a live session" and can drift (e.g. a session left LIVE from
      // before startSession's duplicate-session guard existed). This must
      // still surface the Resume action off the real GameSession row.
      const driftedGame = { id: 'game-1', status: GameStatusEnum.DRAFT };
      mockGameRepo.findAndCount.mockResolvedValue([[driftedGame], 1]);
      mockSessionRepo.find.mockResolvedValue([
        { sessionCode: 'GAME-ORPHAN1', game: { id: 'game-1' } },
      ]);

      const result = await service.listGames(1, 20);

      expect(result.data).toEqual([
        expect.objectContaining({
          id: 'game-1',
          activeSessionCode: 'GAME-ORPHAN1',
        }),
      ]);
    });

    it('returns null activeSessionCode when no game has a live session', async () => {
      mockGameRepo.findAndCount.mockResolvedValue([
        [{ id: 'game-2', status: GameStatusEnum.DRAFT }],
        1,
      ]);
      mockSessionRepo.find.mockResolvedValue([]);

      const result = await service.listGames(1, 20);

      expect(result.data).toEqual([
        expect.objectContaining({ id: 'game-2', activeSessionCode: null }),
      ]);
    });
  });

  describe('getGame', () => {
    it('includes the active session code for a live game', async () => {
      mockGameRepo.findOne.mockResolvedValue({
        id: 'game-1',
        status: GameStatusEnum.LIVE_SESSION_ACTIVE,
      });
      mockSessionRepo.find.mockResolvedValue([
        { sessionCode: 'GAME-LIVE01', game: { id: 'game-1' } },
      ]);

      const result = await service.getGame('game-1');

      expect(result.activeSessionCode).toBe('GAME-LIVE01');
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
