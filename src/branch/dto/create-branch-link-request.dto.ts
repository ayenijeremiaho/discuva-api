import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateBranchLinkRequestDto {
  // The target church's subdomain — the only identifier an admin sending
  // the request would actually know, same as typing in a website address.
  @IsString()
  @IsNotEmpty()
  targetSubdomain: string;

  // See TenantBranchInvite.sponsorPlan — same semantics, applied at accept
  // time instead of signup time.
  @IsOptional()
  @IsBoolean()
  sponsorPlan?: boolean;
}
