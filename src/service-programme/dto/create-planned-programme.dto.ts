import { IsOptional, IsUUID } from 'class-validator';

export class CreatePlannedProgrammeDto {
  @IsUUID()
  serviceSlotId: string;

  // Start from a saved template's order of service.
  @IsOptional()
  @IsUUID()
  templateId?: string;

  // Start from another programme's order (e.g. the other service of the same event).
  @IsOptional()
  @IsUUID()
  copyFromProgrammeId?: string;
}
