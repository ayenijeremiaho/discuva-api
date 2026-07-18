import { IsEnum } from 'class-validator';
import { PastorTypeEnum } from '../enums/pastor-type.enum';

export class AssignPastorDto {
  @IsEnum(PastorTypeEnum)
  type: PastorTypeEnum;
}
