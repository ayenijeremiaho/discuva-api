import { IsArray, IsEnum, IsNotEmpty, IsOptional } from 'class-validator';
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
}
