import { IsBoolean, IsNotEmpty, IsString, ValidateIf } from 'class-validator';

export class SetTenantModuleOverrideDto {
  @IsString()
  @IsNotEmpty()
  moduleKey: string;

  // null explicitly clears the override, reverting this module back to
  // the tenant's plan-based default for this tenant.
  @ValidateIf((o) => o.enabled !== null)
  @IsBoolean()
  enabled: boolean | null;
}
