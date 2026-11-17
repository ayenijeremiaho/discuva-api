import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { CreateGuardianDto } from './create-guardian.dto';
import { CHILD_AGE_RANGES } from '../child-age.util';

export class CreateChildProfileDto {
  @IsString()
  @IsNotEmpty()
  firstname: string;

  @IsString()
  @IsNotEmpty()
  lastname: string;

  @ValidateIf((o: CreateChildProfileDto) => !o.ageRange && !o.ageGroupId)
  @IsDateString({}, { message: 'Give a date of birth or an age range' })
  dateOfBirth?: string;

  @ValidateIf((o: CreateChildProfileDto) => !o.dateOfBirth && !o.ageGroupId)
  @IsIn(CHILD_AGE_RANGES, { message: 'Give a date of birth or an age range' })
  ageRange?: string;

  // One of the church's own age groups, instead of a date of birth.
  @IsUUID('4')
  @IsOptional()
  ageGroupId?: string;

  @IsUrl({}, { message: 'photoUrl must be a valid URL' })
  @IsOptional()
  photoUrl?: string;

  @IsString()
  @IsOptional()
  specialNotes?: string;

  @IsUUID('4')
  @IsOptional()
  registeredByMemberId?: string;

  @IsArray()
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => CreateGuardianDto)
  @IsOptional()
  guardians?: CreateGuardianDto[];
}

export class UpdateChildProfileDto {
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  firstname?: string;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  lastname?: string;

  @IsDateString()
  @IsOptional()
  dateOfBirth?: string;

  @IsIn(CHILD_AGE_RANGES)
  @IsOptional()
  ageRange?: string;

  @IsUUID('4')
  @IsOptional()
  ageGroupId?: string;

  @IsUrl({}, { message: 'photoUrl must be a valid URL' })
  @IsOptional()
  photoUrl?: string;

  @IsString()
  @IsOptional()
  specialNotes?: string;
}
