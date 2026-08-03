import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export class ChannelParamDto {
  @IsIn(['sms', 'email'])
  channel: 'sms' | 'email';
}

// Whole-object @Param() binding validates every path param present on the
// route against the DTO's whitelist — a route with two path params needs
// both declared here, or forbidNonWhitelisted (main.ts) rejects the one
// left out. Used by PATCH :channel/:providerId, which ChannelParamDto alone
// doesn't cover.
export class ChannelAndProviderParamDto extends ChannelParamDto {
  @IsString()
  @IsNotEmpty()
  providerId: string;
}
