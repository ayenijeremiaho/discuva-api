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
