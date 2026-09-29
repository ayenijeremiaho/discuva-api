import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { GuardianRelationshipEnum } from '../enums/guardian-relationship.enum';
import {
  IsNormalizedPhone,
  NormalizePhone,
} from '../../utility/decorators/normalize-phone.decorator';

export class CreateGuardianDto {
  @IsString()
  @IsNotEmpty()
  fullName: string;

  @IsOptional()
  @NormalizePhone()
  @IsNormalizedPhone()
  phoneNumber?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsEnum(GuardianRelationshipEnum)
  relationship: GuardianRelationshipEnum;

  @IsString()
  @IsOptional()
  photoUrl?: string;

  @IsBoolean()
  @IsOptional()
  isAuthorizedPickup?: boolean;

  @IsUUID('4')
  @IsOptional()
  memberId?: string;
}
