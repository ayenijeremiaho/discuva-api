import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UpsertYoutubeIntegrationDto {
  @IsString()
  @IsNotEmpty()
  channelId: string;

  // Omit to use this platform's own default YOUTUBE_API_KEY — a tenant's
  // own key is optional (any valid Data API key can look up any public
  // channel's video snippet, this isn't an access-control requirement the
  // way a tenant's own SMS sender identity is), BYOK here is about
  // isolating quota usage, not correctness.
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  apiKey?: string;
}

export class SetYoutubeIntegrationActiveDto {
  @IsIn([true, false])
  isActive: boolean;
}
