import { IsNotEmpty, IsString } from 'class-validator';

export class ChangeTenantPlanDto {
  @IsString()
  @IsNotEmpty()
  planId: string;
}
