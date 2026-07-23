import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateSmallGroupDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsUUID()
  leaderId?: string;

  @IsOptional()
  @IsString()
  meetingDay?: string;

  @IsOptional()
  @IsString()
  meetingLocation?: string;
}

export class UpdateSmallGroupDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsUUID()
  leaderId?: string;

  @IsOptional()
  @IsString()
  meetingDay?: string;

  @IsOptional()
  @IsString()
  meetingLocation?: string;
}
