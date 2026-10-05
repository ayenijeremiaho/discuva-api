import { IsUUID } from 'class-validator';

export class LinkConvertDto {
  @IsUUID()
  convertId: string;
}
