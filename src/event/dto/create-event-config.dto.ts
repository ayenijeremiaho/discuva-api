import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class CreateEventConfigDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsUUID()
  defaultVenueId: string;

  @IsInt()
  @Max(-1)
  workerCheckinStartOffsetSeconds: number;

  @IsInt()
  @Min(0)
  workerLateOffsetSeconds: number;

  @IsInt()
  @Max(-1)
  memberCheckinStartOffsetSeconds: number;

  @IsInt()
  @Min(0)
  checkinStopOffsetSeconds: number;

  @IsNumber()
  @Min(5)
  allowedDistanceInMeters: number;

  @IsOptional()
  @IsBoolean()
  autoStartSession?: boolean;
}
