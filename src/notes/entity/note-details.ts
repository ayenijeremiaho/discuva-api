import { NoteTypeEnum } from '../enums/note-type.enums';

export class ChildNamingDetails {
  type: NoteTypeEnum.CHILD_NAMING;
  childName: string;
  familyName: string;
  dateOfBirth: Date;
}

export class ChildDedicationDetails {
  type: NoteTypeEnum.CHILD_DEDICATION;
  childName: string;
  familyName: string;
  dedicationDate: Date;
}

export class MarriageDetails {
  type: NoteTypeEnum.MARRIAGE;
  husbandName: string;
  wifeName: string;
  weddingDate: Date;
}

export class BaptismDetails {
  type: NoteTypeEnum.BAPTISM;
  personName: string;
  baptismDate: Date;
}
