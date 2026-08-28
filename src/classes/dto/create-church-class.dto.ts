import {
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ClassFacilitatorInputDto } from './class-facilitator.dto';

export class CreateChurchClassDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsUUID()
  classTypeId: string;

  @IsOptional()
  @IsString()
  description?: string;

  // A class must have at least one facilitator (member or guest).
  @IsArray()
  @ArrayMinSize(1, { message: 'At least one facilitator is required.' })
  @ValidateNested({ each: true })
  @Type(() => ClassFacilitatorInputDto)
  facilitators: ClassFacilitatorInputDto[];

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'startDate must be YYYY-MM-DD' })
  startDate?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'endDate must be YYYY-MM-DD' })
  endDate?: string;
}

export class UpdateChurchClassDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsUUID()
  classTypeId?: string;

  @IsOptional()
  @IsString()
  description?: string;

  // If provided, replaces the full facilitator list — must still be
  // non-empty (a class can't be left with zero facilitators). Omit the
  // field entirely to leave the existing facilitators untouched.
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'At least one facilitator is required.' })
  @ValidateNested({ each: true })
  @Type(() => ClassFacilitatorInputDto)
  facilitators?: ClassFacilitatorInputDto[];

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'startDate must be YYYY-MM-DD' })
  startDate?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'endDate must be YYYY-MM-DD' })
  endDate?: string;
}
