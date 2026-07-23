import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class UpsertSermonNoteDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  note: string;
}
