import {
  IsBoolean,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class CheckinLocationDto {
  @IsLongitude()
  longitude: number;

  @IsLatitude()
  latitude: number;

  // Device-reported error radius in meters (GeolocationCoordinates.accuracy).
  @IsOptional()
  @IsNumber()
  @Min(0)
  accuracy?: number;
}

export class CheckInDto {
  @IsUUID('4', { message: 'Invalid serviceSlotId' })
  serviceSlotId: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CheckinLocationDto)
  location?: CheckinLocationDto;

  // Set by the member app on a first attempt sent with a rough reading: if it's too far, the app listens for a sharper
  // reading and retries once, so this rejection isn't recorded as a blocked check-in. Still rejected as normal.
  @IsOptional()
  @IsBoolean()
  retryable?: boolean;
}
