import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { OrganisationTypeEnum } from '../../tenant/enum/organisation-type.enum';

export class TenantListQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit = 25;

  @IsString()
  @MaxLength(100)
  @IsOptional()
  search?: string;

  @IsIn(['active', 'suspended'])
  @IsOptional()
  status?: 'active' | 'suspended';

  @IsIn(['to_verify', 'verified'])
  @IsOptional()
  verification?: 'to_verify' | 'verified';

  @IsString()
  @MaxLength(100)
  @IsOptional()
  plan?: string;

  @IsIn(Object.values(OrganisationTypeEnum))
  @IsOptional()
  orgType?: OrganisationTypeEnum;
}

export class TenantLookupQueryDto {
  @IsString()
  @MaxLength(100)
  @IsOptional()
  search?: string;

  // Comma-separated ids already chosen, to show their names.
  @Transform(({ value }) =>
    typeof value === 'string' ? value.split(',').filter(Boolean) : value,
  )
  @IsUUID('4', { each: true })
  @IsOptional()
  ids?: string[];
}
