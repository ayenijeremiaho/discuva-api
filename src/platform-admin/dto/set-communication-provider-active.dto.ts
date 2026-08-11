import { IsBoolean } from 'class-validator';

export class SetCommunicationProviderActiveDto {
  @IsBoolean()
  isActive: boolean;
}
