import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class SaveProtectedNameDto {
  @IsString()
  @MaxLength(150)
  name: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  shortForms?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @Matches(/^[a-z0-9-]{2,63}$/i, {
    each: true,
    message: 'Addresses use letters, numbers and hyphens only.',
  })
  addresses?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}
