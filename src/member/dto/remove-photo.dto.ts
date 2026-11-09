import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PhotoRemovalReason } from '../../discuva-account/enum/photo-removal-reason.enum';

// Needed when the photo belongs to someone's Discuva profile; they are emailed the reason.
export class RemovePhotoDto {
  @IsOptional()
  @IsEnum(PhotoRemovalReason)
  reason?: PhotoRemovalReason;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string | null;
}
