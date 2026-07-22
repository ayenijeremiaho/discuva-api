import { IsUUID } from 'class-validator';

export class PromoteEnrollmentDto {
  @IsUUID()
  targetClassId: string;
}
