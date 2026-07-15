import { ArrayMinSize, IsArray, IsUUID } from 'class-validator';

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
