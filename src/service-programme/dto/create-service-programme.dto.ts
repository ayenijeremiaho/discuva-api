import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CreateServiceProgrammeSlotDto } from './create-service-programme-slot.dto';

// One entry per service slot being programmed in this call. Each slot's
// order-of-service is independent — a multi-service Sunday (First/Second
// Service) is built once per slot in the same request instead of one round
// trip per slot, but the two lists don't have to (and usually won't) match
// exactly.
export class CreateServiceProgrammeItemDto {
  @IsUUID()
  @IsNotEmpty()
  serviceSlotId: string;

  // Full order-of-service, provided up front so the programme is created
  // already populated instead of empty and built up one addSlot call at a
  // time. Optional — an empty draft (added to later) is still supported.
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CreateServiceProgrammeSlotDto)
  slots?: CreateServiceProgrammeSlotDto[];
}

export class CreateServiceProgrammeDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'At least one service slot is required' })
  @ValidateNested({ each: true })
  @Type(() => CreateServiceProgrammeItemDto)
  programmes: CreateServiceProgrammeItemDto[];

  @IsBoolean()
  @IsOptional()
  saveAsTemplate?: boolean;
}
