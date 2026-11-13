import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsDefined,
  IsIn,
} from 'class-validator';
import { MEMBER_EXPORT_FIELD_KEYS } from '../utility/member-csv';

export class UpdateExportSettingsDto {
  @IsDefined()
  @IsArray()
  @ArrayMaxSize(32)
  @ArrayUnique()
  @IsIn(MEMBER_EXPORT_FIELD_KEYS, { each: true })
  fields: string[];
}
