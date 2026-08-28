import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

// Exactly one of memberId/guestName must be set — validated in
// ClassesService (not here) since class-validator's @ValidateIf can't
// easily express "exactly one of two fields", and the service already owns
// the equivalent check for ClassMaterial's publicId-vs-link split.
export class ClassFacilitatorInputDto {
  @IsOptional()
  @IsUUID()
  memberId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  guestName?: string;
}
