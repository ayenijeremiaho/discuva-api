import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsISO8601,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  Min,
  ValidateNested,
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class AddBranchDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;

  // Becomes the address after the network's own ("abc-ikeja"): letters and numbers only.
  @Matches(/^[A-Za-z0-9][A-Za-z0-9 ]{0,38}$/, {
    message: 'Use letters, numbers and spaces only, up to 39 characters.',
  })
  label: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  ownerFirstname: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  ownerLastname: string;

  @IsEmail()
  ownerEmail: string;

  @IsOptional()
  @IsBoolean()
  sponsor?: boolean;
}

export class MoveChurchDto {
  @IsUUID()
  parentId: string;
}

export class NetworkLevelsDto {
  // Index 0 names the level under the top church, and so on down.
  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  names: string[];
}

export class GivingSharingDto {
  @IsBoolean()
  shareGivingWithParent: boolean;
}

export class TransferRequestDto {
  @IsUUID()
  toTenantId: string;
}

export class DeclineTransferDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class VisitLocationDto {
  @Type(() => Number)
  @IsLatitude()
  latitude: number;

  @Type(() => Number)
  @IsLongitude()
  longitude: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  accuracy?: number;
}

export class VisitCheckInDto {
  @IsUUID()
  tenantId: string;

  @IsUUID()
  serviceSlotId: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => VisitLocationDto)
  location?: VisitLocationDto;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9]{6}$/)
  code?: string;
}

export class DateWindowDto {
  @IsISO8601()
  from: string;

  @IsISO8601()
  to: string;

  @IsOptional()
  @IsUUID()
  churchId?: string;
}

export class HiddenDto {
  @IsBoolean()
  hidden: boolean;
}

export class ReportQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  month?: string;
}

export class NetworkSettingsDto {
  @IsOptional() @IsInt() attendanceDropPercent?: number;
  @IsOptional() @IsInt() attendanceWeeks?: number;
  @IsOptional() @IsInt() notContactedCount?: number;
  @IsOptional() @IsInt() notContactedDays?: number;
  @IsOptional() @IsInt() noServiceWeeks?: number;
  @IsOptional() @IsInt() unreachablePercent?: number;
  @IsOptional() @IsInt() minAdmins?: number;
  @IsOptional() @IsInt() visitSuggestVisits?: number;
  @IsOptional() @IsInt() visitSuggestWeeks?: number;
}
