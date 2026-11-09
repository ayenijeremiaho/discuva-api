import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import {
  CLASS_MILESTONE_TYPES,
  type ClassMilestoneType,
} from '../../discuva-account/enum/milestone.enum';

export class CreateClassTypeDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsUUID()
  nextClassTypeId?: string;

  // Completing a class of this type adds this milestone to members' Discuva profiles; null for none.
  @IsOptional()
  @IsIn([...CLASS_MILESTONE_TYPES, null])
  countsAs?: ClassMilestoneType | null;
}

export class UpdateClassTypeDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsUUID()
  nextClassTypeId?: string;

  // Completing a class of this type adds this milestone to members' Discuva profiles; null for none.
  @IsOptional()
  @IsIn([...CLASS_MILESTONE_TYPES, null])
  countsAs?: ClassMilestoneType | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
