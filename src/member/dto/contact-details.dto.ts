import { IsOptional, IsString, MaxLength } from 'class-validator';
import {
  IsNormalizedPhone,
  NormalizePhone,
} from '../../utility/decorators/normalize-phone.decorator';

// Address and emergency contact; null clears a value.
export class ContactDetailsDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  emergencyContactName?: string | null;

  @IsOptional()
  @NormalizePhone({ clearable: true })
  @IsNormalizedPhone()
  emergencyContactPhone?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  emergencyContactRelationship?: string | null;
}
