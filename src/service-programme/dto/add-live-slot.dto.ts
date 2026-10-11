import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ServiceSlotTypeEnum } from '../enum/service-slot-type.enum';

export class AddLiveSlotDto {
  @IsEnum(ServiceSlotTypeEnum)
  type: ServiceSlotTypeEnum;

  @IsString()
  @MaxLength(255)
  @IsOptional()
  topic?: string;

  @IsUUID()
  @IsOptional()
  memberId?: string;

  @IsString()
  @MaxLength(255)
  @IsOptional()
  guestName?: string;

  @IsInt()
  @Min(1)
  @Max(600)
  allocatedMinutes: number;

  // Running-order position for the new section; defaults to the end. Must be after the current slot.
  @IsInt()
  @Min(1)
  @IsOptional()
  position?: number;
}
