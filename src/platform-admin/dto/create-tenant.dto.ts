import { IsOptional, IsString } from 'class-validator';
import { SignupDto } from '../../tenant/dto/signup.dto';

// Same shape POST /signup accepts — both call the same
// TenantProvisioningService (§4.8) — plus an optional plan override for
// platform-admin-triggered provisioning (comps, support cases).
export class CreateTenantDto extends SignupDto {
  @IsOptional()
  @IsString()
  planId?: string;
}
