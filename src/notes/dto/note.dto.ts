import {
  ArrayMaxSize,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { NoteKindEnum } from '../enum/note-kind.enum';
import type { NoteNode } from '../util/note-content';

export class CreateNoteDto {
  @IsOptional()
  @IsEnum(NoteKindEnum)
  kind?: NoteKindEnum;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsObject()
  content: NoteNode;

  @IsOptional()
  @IsUUID()
  sermonId?: string;

  // Starting a note for a service returns the member's existing note for it instead of a second one.
  @IsOptional()
  @IsUUID()
  serviceSlotId?: string;
}

export class UpdateNoteDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsObject()
  content?: NoteNode;

  @IsOptional()
  @IsBoolean()
  pinned?: boolean;

  @IsOptional()
  @IsUUID()
  sermonId?: string | null;

  // Link the note to a service (null unlinks). One note per member per service.
  @IsOptional()
  @IsUUID()
  serviceSlotId?: string | null;

  // The updatedAt the client last saw; a newer server copy means it was edited elsewhere.
  @IsOptional()
  @IsDateString()
  baseUpdatedAt?: string;
}

export class NoteQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;

  @IsOptional()
  @IsEnum(NoteKindEnum)
  kind?: NoteKindEnum;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsUUID()
  sermonId?: string;
}

export class TopScripturesQueryDto {
  @IsUUID()
  eventId: string;
}

export class ScriptureTapDto {
  @IsString()
  @Matches(/^[A-Z0-9]{2,16}$/)
  version: string;

  @IsInt()
  @Min(1)
  @Max(500)
  count: number;
}

export class ScriptureTapsDto {
  @ValidateNested({ each: true })
  @Type(() => ScriptureTapDto)
  @ArrayMaxSize(20)
  taps: ScriptureTapDto[];
}

export class NotePreferencesDto {
  @IsBoolean()
  nudges: boolean;
}
