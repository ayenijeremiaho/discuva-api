import { BadRequestException, Injectable, Logger } from '@nestjs/common';

export interface CheckedChannel {
  channelId: string;
  channelTitle: string;
}

const CHANNEL_ID = /^UC[\w-]{22}$/;
const CHECK_TIMEOUT_MS = 8000;

// Google's error reasons, as a church admin would need to hear them.
const REASONS: Record<string, string> = {
  keyInvalid:
    "That API key isn't valid. Copy it again from Google Cloud Console → APIs & Services → Credentials.",
  API_KEY_INVALID:
    "That API key isn't valid. Copy it again from Google Cloud Console → APIs & Services → Credentials.",
  accessNotConfigured:
    "The YouTube Data API v3 isn't switched on for this key's project. In Google Cloud Console open APIs & Services → Library, search for YouTube Data API v3 and click Enable. It can take a few minutes to start working.",
  SERVICE_DISABLED:
    "The YouTube Data API v3 isn't switched on for this key's project. In Google Cloud Console open APIs & Services → Library, search for YouTube Data API v3 and click Enable. It can take a few minutes to start working.",
  quotaExceeded:
    'This key has used up its free YouTube quota for today. It resets at midnight Pacific time; try again after that.',
  dailyLimitExceeded:
    'This key has used up its free YouTube quota for today. It resets at midnight Pacific time; try again after that.',
  ipRefererBlocked:
    "This key is restricted to certain websites or IP addresses, so it can't be used from our server. In Credentials, edit the key and set Application restrictions to None (you can keep it limited to YouTube Data API v3).",
  API_KEY_HTTP_REFERRER_BLOCKED:
    "This key is restricted to certain websites, so it can't be used from our server. In Credentials, edit the key and set Application restrictions to None (you can keep it limited to YouTube Data API v3).",
  API_KEY_IP_ADDRESS_BLOCKED:
    "This key is restricted to certain IP addresses, so it can't be used from our server. In Credentials, edit the key and set Application restrictions to None (you can keep it limited to YouTube Data API v3).",
  API_KEY_SERVICE_BLOCKED:
    "This key isn't allowed to use the YouTube Data API. In Credentials, edit the key and add YouTube Data API v3 under API restrictions.",
};

interface YoutubeError {
  error?: {
    message?: string;
    errors?: { reason?: string }[];
    details?: { reason?: string }[];
  };
}

// Checks a key and channel with YouTube before they're saved, so a church learns about a mistake now, not on a silent Sunday.
@Injectable()
export class YoutubeChannelCheckService {
  private readonly logger = new Logger(YoutubeChannelCheckService.name);

  // Accepts a channel ID, a /channel/ link, or an @handle (or its link) and returns the real channel.
  async check(input: string, apiKey: string): Promise<CheckedChannel> {
    const value = input.trim();
    const fromLink = value.match(/\/channel\/(UC[\w-]{22})/)?.[1];
    const handle = value.match(/(?:^|youtube\.com\/)(@[\w.-]+)/)?.[1];
    let query: string;
    if (CHANNEL_ID.test(value) || fromLink) query = `id=${fromLink ?? value}`;
    else if (handle) query = `forHandle=${encodeURIComponent(handle)}`;
    else
      throw new BadRequestException(
        'Paste your channel link, its @handle (like @yourchurch), or the channel ID that starts with UC.',
      );

    let response: Response;
    try {
      response = await fetch(
        `https://www.googleapis.com/youtube/v3/channels?part=snippet&${query}&key=${encodeURIComponent(apiKey)}`,
        // A save holds the request's transaction open, so a slow YouTube mustn't hang it.
        { signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) },
      );
    } catch (err) {
      this.logger.warn(`YouTube check failed: ${(err as Error).message}`);
      throw new BadRequestException(
        "Couldn't reach YouTube to check this. Please try again in a moment.",
      );
    }
    const body = (await response.json().catch(() => ({}))) as YoutubeError & {
      items?: { id: string; snippet?: { title?: string } }[];
    };
    if (!response.ok) {
      const reasons = [
        ...(body.error?.errors ?? []).map((e) => e.reason),
        ...(body.error?.details ?? []).map((d) => d.reason),
      ];
      const known = reasons.find((r) => r && REASONS[r]);
      throw new BadRequestException(
        known
          ? REASONS[known]
          : `YouTube didn't accept this key: ${body.error?.message ?? `error ${response.status}`}`,
      );
    }
    const channel = body.items?.[0];
    if (!channel)
      throw new BadRequestException(
        handle
          ? `No YouTube channel has the handle ${handle}. Check it on your channel's page.`
          : 'No YouTube channel has that ID. Copy it from YouTube Studio → Settings → Channel → Advanced settings.',
      );
    return {
      channelId: channel.id,
      channelTitle: channel.snippet?.title ?? channel.id,
    };
  }
}
