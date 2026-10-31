import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
  IsDateString,
} from 'class-validator';

export class RotaEntryDto {
  @IsUUID()
  memberId: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  role?: string;
}

export class SaveRotaDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => RotaEntryDto)
  entries: RotaEntryDto[];
}

export class RequestCoverDto {
  @IsOptional()
  @IsUUID()
  targetMemberId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class GenerateRotaDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => RotaEntryDto)
  lockedEntries?: RotaEntryDto[];
}

export class SaveRotaUnavailabilityDto {
  @IsDateString()
  date: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}
