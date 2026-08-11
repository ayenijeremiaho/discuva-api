import { IsBoolean } from 'class-validator';

export class SetPaymentProviderActiveDto {
  @IsBoolean()
  isActive: boolean;
}
