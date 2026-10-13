import { ArrayMinSize, IsArray, IsBoolean, IsUUID } from 'class-validator';

export class BulkUpdateTraineeDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID(undefined, { each: true })
  memberIds: string[];

  @IsBoolean()
  isTrainee: boolean;
}
