import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class SaveProgrammeTemplateDto {
  // Saving under an existing template's name replaces that template.
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name: string;
}
