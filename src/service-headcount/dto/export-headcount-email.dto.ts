import { IsDateString, IsEmail, IsOptional, IsUUID } from 'class-validator';

export class ExportHeadcountEmailDto {
  @IsEmail()
  @IsOptional()
  recipientEmail?: string;

  @IsUUID()
  @IsOptional()
  serviceSlotId?: string;

  @IsDateString()
  @IsOptional()
  from?: string;

  @IsDateString()
  @IsOptional()
  to?: string;
}
