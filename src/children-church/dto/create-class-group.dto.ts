import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class CreateChildClassGroupDto {
  @IsUUID('4')
  ageGroupId: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  capacity?: number;

  @IsString()
  @IsOptional()
  teacherNote?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  childrenPerTeacher?: number | null;
}

export class UpdateChildClassGroupDto {
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  name?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  capacity?: number;

  @IsString()
  @IsOptional()
  teacherNote?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  childrenPerTeacher?: number | null;
}

export class SetRoomDutyDto {
  // Left out or null: the front desk, every room.
  @IsUUID('4')
  @IsOptional()
  classGroupId?: string | null;
}
