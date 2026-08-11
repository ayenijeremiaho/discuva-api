import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateClergyTitleDto {
  @IsNotEmpty()
  @MaxLength(40)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;
}
