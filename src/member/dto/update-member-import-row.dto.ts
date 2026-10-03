import { IsNotEmptyObject, IsObject } from 'class-validator';

export class UpdateMemberImportRowDto {
  @IsObject()
  @IsNotEmptyObject()
  data: Record<string, unknown>;
}
