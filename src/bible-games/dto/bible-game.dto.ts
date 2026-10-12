import { TURN_HOURS_OPTIONS } from '../engine/duel';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import { BibleGameModeEnum } from '../enum/bible-game-mode.enum';
import { LEVEL_COUNT } from '../engine/levels';

export class StartRoundDto {
  @IsEnum(BibleGameModeEnum)
  mode: BibleGameModeEnum;

  @ValidateIf((o: StartRoundDto) => o.mode === BibleGameModeEnum.LEVEL)
  @IsInt()
  @Min(1)
  @Max(LEVEL_COUNT)
  level?: number;
}

export class AnswerDto {
  @IsInt()
  @Min(0)
  index: number;

  // null when the time ran out without an answer.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3)
  choice: number | null;
}

export class ScoreboardQueryDto {
  @IsOptional()
  @IsIn(['month', 'all'])
  period?: 'month' | 'all' = 'month';

  // All games, Levels (how far people have climbed) or Daily & weekly; Characters has its own route.
  @IsOptional()
  @IsIn(['all', 'levels', 'daily'])
  board?: 'all' | 'levels' | 'daily' = 'all';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(100)
  limit?: number = 50;
}

export class CharacterScoreboardQueryDto {
  @IsOptional()
  @IsIn(['month', 'all'])
  period?: 'month' | 'all' = 'month';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(100)
  limit?: number = 50;
}

export class PreviewQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(LEVEL_COUNT)
  level: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  seed?: number = 0;
}

export class HideQuestionDto {
  // A question key ("finish:JHN.3.16:7") or "verse:JHN.3.16" for every question on that verse.
  @IsString()
  @Matches(/^(verse:[1-3A-Z]{3}\.\d+\.\d+|[a-z]+:[A-Za-z0-9.:,-]+)$/)
  @MaxLength(120)
  key: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  label?: string;
}

export class CustomQuestionDto {
  @IsString()
  @Length(5, 300)
  prompt: string;

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(4)
  @ArrayUnique((o: string) => o.trim().toLowerCase())
  @IsString({ each: true })
  @Length(1, 120, { each: true })
  options: string[];

  @IsInt()
  @Min(0)
  @Max(3)
  answer: number;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  explain?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(LEVEL_COUNT)
  levelMin?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(LEVEL_COUNT)
  levelMax?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateCustomQuestionDto extends PartialType(CustomQuestionDto) {}

export class UpdateBibleCharacterDto {
  @IsOptional()
  @IsBoolean()
  reviewed?: boolean;

  @IsOptional()
  @IsBoolean()
  hidden?: boolean;

  // null restores the original summary.
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(160)
  summary?: string | null;

  // 2–3 verses, as "Genesis 12:1" or "GEN.12.1"; null restores the original clues.
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(3)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  clues?: string[] | null;
}

export class BibleCharacterSettingsDto {
  @IsOptional()
  @IsBoolean()
  onlyReviewed?: boolean;

  @IsOptional()
  @IsIn([...TURN_HOURS_OPTIONS])
  turnHours?: number;
}

export class StartCharacterRoundDto {
  @IsIn(['easy', 'medium', 'hard'])
  difficulty: 'easy' | 'medium' | 'hard';
}

export class AskCharacterQuestionDto {
  @IsString()
  @Matches(/^[a-z_]{2,30}$/)
  questionId: string;
}

export class GuessCharacterDto {
  @IsString()
  @Matches(/^[a-z0-9_]{1,40}$/)
  characterId: string;
}

export class InviteDuelDto {
  @IsUUID()
  opponentId: string;

  @IsIn(['easy', 'medium', 'hard'])
  difficulty: 'easy' | 'medium' | 'hard';
}

export class DuelOpponentsQueryDto {
  @IsString()
  @Length(2, 60)
  search: string;
}

export class CharadesQueryDto {
  @IsOptional()
  @IsIn(['easy', 'medium', 'hard'])
  difficulty?: 'easy' | 'medium' | 'hard';
}
