import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsUUID,
} from 'class-validator';
import { DepartmentCapability } from '../enums/department-capability.enum';

export class CreateDepartmentDto {
  @IsNotEmpty()
  name: string;

  @IsNotEmpty()
  description: string;

  @IsOptional()
  @IsArray()
  @IsEnum(DepartmentCapability, { each: true })
  capabilities?: DepartmentCapability[];

  // Omit or null for a church-wide department.
  @IsOptional()
  @IsUUID()
  campusId?: string | null;
}
