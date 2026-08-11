import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class BroadcastDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  subject: string;

  // Plain text, not HTML — see TenantBroadcastService's plainTextToHtml for
  // why (a platform admin typing into a form textarea shouldn't be able to
  // inject arbitrary markup into an email reaching every church at once).
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  message: string;
}
