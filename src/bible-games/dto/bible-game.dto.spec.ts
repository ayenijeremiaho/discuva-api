import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { AskCharacterQuestionDto } from './bible-game.dto';
import { CHARACTER_QUESTIONS } from '../engine/characters';

describe('AskCharacterQuestionDto', () => {
  it('accepts every question the game can suggest or list', () => {
    const rejected = CHARACTER_QUESTIONS.filter(
      (q) =>
        validateSync(
          plainToInstance(AskCharacterQuestionDto, { questionId: q.id }),
        ).length > 0,
    ).map((q) => q.id);
    expect(rejected).toEqual([]);
  });

  it.each(['', 'A_B', 'drop table', '1abc', 'x'.repeat(31)])(
    'rejects %p',
    (questionId) => {
      expect(
        validateSync(plainToInstance(AskCharacterQuestionDto, { questionId }))
          .length,
      ).toBeGreaterThan(0);
    },
  );
});
