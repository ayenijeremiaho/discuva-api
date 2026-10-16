import { Injectable } from '@nestjs/common';
import { AnnouncementService } from './announcement.service';
import { CacheService } from '../../utility/service/cache.service';

export interface LiveBroadcast {
  platform: string;
  title?: string | null;
  url: string;
}

const LIVE_NOW_KEY = 'live-now';
const LOCK_KEY = 'lock:live-now';
// Long enough to cover a service, so a second platform joins the same announcement.
const SERVICE_TTL_SECONDS = 4 * 3600;
const LOCK_ATTEMPTS = 10;
const LOCK_WAIT_MS = 300;

// One "we're live" announcement (and one push) per service, however many platforms the church streams to.
// Must run in the church's context.
@Injectable()
export class LiveAnnouncementService {
  constructor(
    private readonly announcementService: AnnouncementService,
    private readonly cacheService: CacheService,
  ) {}

  async announce(live: LiveBroadcast): Promise<void> {
    // Two platforms going live together must not both create an announcement.
    let locked = false;
    for (let i = 0; i < LOCK_ATTEMPTS && !locked; i++) {
      locked = await this.cacheService.acquireLock(LOCK_KEY, 30);
      if (!locked) await new Promise((r) => setTimeout(r, LOCK_WAIT_MS));
    }
    try {
      const existingId = await this.cacheService.get<string>(LIVE_NOW_KEY);
      if (
        existingId &&
        (await this.announcementService.appendToSystemAnnouncement(
          existingId,
          `Also live on ${live.platform}: ${live.url}`,
        ))
      )
        return;

      const created = await this.announcementService.createSystemAnnouncement(
        `🔴 Live Now: ${live.title?.trim() || 'Service'}`,
        `We're live now on ${live.platform} — tap to watch.\n\n${live.url}`,
      );
      await this.cacheService.set(
        LIVE_NOW_KEY,
        created.id,
        SERVICE_TTL_SECONDS,
      );
    } finally {
      if (locked) this.cacheService.releaseLock(LOCK_KEY);
    }
  }
}
