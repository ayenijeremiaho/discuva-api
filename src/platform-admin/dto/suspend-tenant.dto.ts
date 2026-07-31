import { IsBoolean, IsOptional } from 'class-validator';

export class SuspendTenantDto {
  // Same endpoint handles both directions — defaults to true (suspend) so
  // the common case (`PATCH .../suspend` with no body) does the obvious
  // thing; pass `{ suspend: false }` to reactivate.
  @IsOptional()
  @IsBoolean()
  suspend?: boolean;
}
