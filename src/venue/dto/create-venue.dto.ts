import {
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';
import { OmitType, PartialType } from '@nestjs/mapped-types';

export class CreateVenueDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsLatitude()
  latitude: number;

  @IsLongitude()
  longitude: number;
}

export class UpdateVenueDto extends PartialType(
  OmitType(CreateVenueDto, ['latitude', 'longitude'] as const),
) {
  @ValidateIf((o) => o.latitude !== undefined || o.longitude !== undefined)
  @IsLatitude()
  latitude?: number;

  @ValidateIf((o) => o.latitude !== undefined || o.longitude !== undefined)
  @IsLongitude()
  longitude?: number;
}
