import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsOptional,
  IsUUID,
} from 'class-validator';

// Members to add to a class, by id (picked in the admin list) and/or email (pasted). At least one is required.
export class BulkAssignSundaySchoolMembersDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  memberIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsEmail({}, { each: true })
  emails?: string[];
}
