import { Injectable } from '@nestjs/common';
import { AnnouncementService } from './announcement.service';
import { CacheService } from '../../utility/service/cache.service';

export interface LiveBroadcast {
  platform: string;
  title?: string | null;
  url: string;
  // Replaces the default "🔴 Live Now: <title>" heading.
  heading?: string;
}

const LIVE_NOW_KEY = 'live-now';

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
const watchLink = (live: LiveBroadcast, label: string) =>
  `<p><a href="${escapeHtml(live.url)}">${escapeHtml(label)}</a></p>`;
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

  async announce(live: LiveBroadcast, actorId?: string): Promise<void> {
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
          watchLink(live, `Also live on ${live.platform}`),
          `href="${escapeHtml(live.url)}"`,
        ))
      )
        return;

      const created = await this.announcementService.createSystemAnnouncement(
        live.heading ?? `🔴 Live Now: ${live.title?.trim() || 'Service'}`,
        `<p>We're live now on ${escapeHtml(live.platform)}. Tap to watch.</p>${watchLink(live, `Watch on ${live.platform}`)}`,
        actorId,
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
