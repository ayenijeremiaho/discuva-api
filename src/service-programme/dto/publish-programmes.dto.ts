import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';

export class PublishProgrammesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  programmeIds: string[];
}
