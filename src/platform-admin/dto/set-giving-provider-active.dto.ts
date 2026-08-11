import { IsBoolean } from 'class-validator';

export class SetGivingProviderActiveDto {
  @IsBoolean()
  isActive: boolean;
}
