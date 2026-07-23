import { NoteTypeEnum } from '../enums/note-type.enums';
import { Exclude, Expose, Type } from 'class-transformer';
import { ToDateString } from '../../utility/dto/date-converter';

export type NoteDetailsDto =
  | ChildNamingDetailsDto
  | ChildDedicationDetailsDto
  | MarriageDetailsDto
  | BaptismDetailsDto;

@Exclude()
export class NoteMemberRefDto {
  @Expose()
  id: string;

  @Expose()
  firstname: string;

  @Expose()
  lastname: string;
}

@Exclude()
export class NoteDto {
  @Expose()
  id: string;

  @Expose()
  type: NoteTypeEnum;

  @Expose()
  details: NoteDetailsDto;

  @Expose()
  @Type(() => NoteMemberRefDto)
  member: NoteMemberRefDto | null;

  @Expose()
  @ToDateString()
  createdAt: Date;

  @Expose()
  @ToDateString()
  updatedAt: Date;
}

@Exclude()
export class ChildNamingDetailsDto {
  @Expose()
  type: NoteTypeEnum.CHILD_NAMING;

  @Expose()
  childName: string;

  @Expose()
  familyName: string;

  @Expose()
  @ToDateString()
  dateOfBirth: Date;
}

@Exclude()
export class ChildDedicationDetailsDto {
  @Expose()
  type: NoteTypeEnum.CHILD_DEDICATION;

  @Expose()
  childName: string;

  @Expose()
  familyName: string;

  @Expose()
  @ToDateString()
  dedicationDate: Date;
}

@Exclude()
export class MarriageDetailsDto {
  @Expose()
  type: NoteTypeEnum.MARRIAGE;

  @Expose()
  husbandName: string;

  @Expose()
  wifeName: string;

  @Expose()
  @ToDateString()
  weddingDate: Date;
}

@Exclude()
export class BaptismDetailsDto {
  @Expose()
  type: NoteTypeEnum.BAPTISM;

  @Expose()
  personName: string;

  @Expose()
  @ToDateString()
  baptismDate: Date;
}
