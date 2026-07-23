import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
} from 'class-validator';
import { NoteTypeEnum } from '../enums/note-type.enums';

export class ChildNamingRequest {
  @IsString()
  type: NoteTypeEnum.CHILD_NAMING;

  @IsNotEmpty()
  childName: string;

  @IsNotEmpty()
  familyName: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'dateOfBirth must be YYYY-MM-DD' })
  dateOfBirth: string;

  @IsOptional()
  @IsUUID()
  memberId?: string;
}

export class ChildDedicationRequest {
  @IsString()
  type: NoteTypeEnum.CHILD_DEDICATION;

  @IsNotEmpty()
  childName: string;

  @IsNotEmpty()
  familyName: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'dedicationDate must be YYYY-MM-DD',
  })
  dedicationDate: string;

  @IsOptional()
  @IsUUID()
  memberId?: string;
}

export class MarriageRequest {
  @IsString()
  type: NoteTypeEnum.MARRIAGE;

  @IsNotEmpty()
  husbandName: string;

  @IsNotEmpty()
  wifeName: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'weddingDate must be YYYY-MM-DD' })
  weddingDate: string;

  @IsOptional()
  @IsUUID()
  memberId?: string;
}

export class BaptismRequest {
  @IsString()
  type: NoteTypeEnum.BAPTISM;

  @IsNotEmpty()
  personName: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'baptismDate must be YYYY-MM-DD' })
  baptismDate: string;

  @IsOptional()
  @IsUUID()
  memberId?: string;
}
