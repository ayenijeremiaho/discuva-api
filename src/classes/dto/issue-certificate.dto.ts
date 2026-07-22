import { IsOptional, IsString } from 'class-validator';

export class IssueCertificateDto {
  @IsOptional()
  @IsString()
  certificateNumber?: string;
}
