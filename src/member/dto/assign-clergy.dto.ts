import { IsUUID } from 'class-validator';

export class AssignClergyDto {
  @IsUUID('4')
  clergyTitleId: string;
}
