import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
} from 'class-validator';

export class AddClassMaterialLinkDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(150)
  title: string;

  @IsUrl()
  url: string;
}

export class ReuseClassMaterialDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(150)
  title: string;

  @IsUrl()
  url: string;

  @IsOptional()
  @IsString()
  publicId?: string;

  @IsOptional()
  @IsString()
  resourceType?: string;

  @IsOptional()
  @IsString()
  mimeType?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sizeBytes?: number;
}
