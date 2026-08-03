import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateSharingConsentDto {
  @IsOptional()
  @IsBoolean()
  shareDataWithParent?: boolean;

  @IsOptional()
  @IsBoolean()
  shareGivingWithParent?: boolean;
}
