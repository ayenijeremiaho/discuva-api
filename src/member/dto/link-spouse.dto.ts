import { IsUUID } from 'class-validator';

export class LinkSpouseDto {
  @IsUUID()
  spouseId: string;
}
