import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UpsertYoutubeIntegrationDto {
  @IsString()
  @IsNotEmpty()
  channelId: string;

  // Optional at save time, but live-detection is a no-op without one —
  // there is no platform-wide fallback key. A tenant can set the channel
  // first and add a key later; until they do, notifications from that
  // channel are silently ignored (see YoutubeLiveDetectionService).
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  apiKey?: string;
}

export class SetYoutubeIntegrationActiveDto {
  @IsIn([true, false])
  isActive: boolean;
}
