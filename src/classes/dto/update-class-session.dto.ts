import { IsISO8601, IsOptional, IsUrl } from 'class-validator';

export class UpdateClassSessionDto {
  @IsOptional()
  @IsISO8601()
  nextSessionAt?: string | null;

  @IsOptional()
  @IsUrl()
  meetingLink?: string | null;
}
