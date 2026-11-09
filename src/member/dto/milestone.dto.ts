import { Expose, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  MilestoneSource,
  MilestoneType,
  MilestoneVisibility,
} from '../../discuva-account/enum/milestone.enum';

export class CreateMilestoneDto {
  @IsEnum(MilestoneType)
  type: MilestoneType;

  // Needed for "Other"; optional otherwise.
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  month?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1900)
  @Max(2100)
  year?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  placeName?: string | null;

  @IsOptional()
  @IsEnum(MilestoneVisibility)
  visibility?: MilestoneVisibility;
}

export class UpdateMilestoneDto {
  @IsOptional()
  @IsEnum(MilestoneType)
  type?: MilestoneType;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  month?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1900)
  @Max(2100)
  year?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  placeName?: string | null;

  @IsOptional()
  @IsEnum(MilestoneVisibility)
  visibility?: MilestoneVisibility;

  @IsOptional()
  @IsBoolean()
  hidden?: boolean;
}

export class RecordBaptismDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  month?: number | null;

  @IsInt()
  @Min(1900)
  @Max(2100)
  year: number;
}

export class MilestoneDto {
  @Expose()
  id: string;

  @Expose()
  type: MilestoneType;

  @Expose()
  title: string | null;

  @Expose()
  month: number | null;

  @Expose()
  year: number | null;

  @Expose()
  placeName: string | null;

  @Expose()
  source: MilestoneSource;

  // The church that recorded it, or null when the person added it.
  @Expose()
  @Transform(
    ({ obj }) =>
      obj.source === MilestoneSource.CHURCH ? obj.sourceName : null,
    { toClassOnly: true },
  )
  recordedBy: string | null;

  @Expose()
  visibility: MilestoneVisibility;

  @Expose()
  hidden: boolean;
}
