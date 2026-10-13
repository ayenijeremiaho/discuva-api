import {
  IsBoolean,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
} from 'class-validator';

export class BulkPromoteToWorkerDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID(undefined, { each: true })
  memberIds: string[];

  @IsUUID()
  departmentId: string;

  @IsOptional()
  @IsString()
  profession?: string;

  @IsOptional()
  @Matches(/^\d{4}$/)
  yearJoinedWorkforce?: string;

  @IsOptional()
  @IsBoolean()
  isTrainee?: boolean;
}
