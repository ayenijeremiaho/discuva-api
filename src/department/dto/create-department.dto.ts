import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateDepartmentDto {
  @IsNotEmpty()
  name: string;

  @IsNotEmpty()
  description: string;

  // Free-form access category — not validated against DepartmentKeyEnum,
  // which is only a set of preset suggestions for the frontend picker (see
  // Department.key's doc comment).
  @IsOptional()
  @IsString()
  key?: string;
}
