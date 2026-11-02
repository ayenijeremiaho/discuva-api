import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateCampusDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name: string;
}

export class UpdateCampusDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  // Needed to close a campus that still has members.
  @IsOptional()
  @IsUUID()
  moveMembersTo?: string;
}

export class SetCampusVenuesDto {
  @IsUUID('all', { each: true })
  venueIds: string[];
}

export class MoveMyCampusDto {
  @IsUUID()
  campusId: string;
}

export class CampusMovesQueryDto {
  @IsOptional()
  @IsUUID()
  campusId?: string;

  @IsOptional()
  @IsIn(['joined', 'left'])
  direction?: 'joined' | 'left';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}
