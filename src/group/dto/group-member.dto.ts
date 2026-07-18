import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export class AddGroupMemberDto {
  @IsUUID()
  memberId: string;
}

export class BulkAddGroupMembersDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID(undefined, { each: true })
  memberIds: string[];
}

export class BulkRemoveGroupMembersDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID(undefined, { each: true })
  memberIds: string[];
}

export class BulkRemoveGroupEntriesDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID(undefined, { each: true })
  entryIds: string[];
}

export class PhoneGroupEntryDto {
  @IsString()
  @IsNotEmpty()
  phoneNumber: string;

  @IsOptional()
  @IsString()
  label?: string;
}

export class AddPhoneGroupMembersDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PhoneGroupEntryDto)
  entries: PhoneGroupEntryDto[];
}

export class AddFirstTimersToGroupDto {
  @IsISO8601()
  dateFrom: string;

  @IsISO8601()
  dateTo: string;
}
