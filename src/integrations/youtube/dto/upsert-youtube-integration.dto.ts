import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UpsertYoutubeIntegrationDto {
  // A channel ID, a /channel/ link, or an @handle; saved as the channel ID YouTube returns.
  @IsString()
  @IsNotEmpty()
  channelId: string;

  // Required the first time; afterwards leave it out to keep the saved key. There's no platform key to fall back on.
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  apiKey?: string;
}

export class SetYoutubeIntegrationActiveDto {
  @IsIn([true, false])
  isActive: boolean;
}
