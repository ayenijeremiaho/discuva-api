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
