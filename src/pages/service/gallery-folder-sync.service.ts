import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CacheService } from '../../utility/service/cache.service';

const DRIVE_FOLDER_ID_PATTERN = /\/folders\/([a-zA-Z0-9_-]+)/;
const IMAGE_MIME_PREFIX = 'image/';
// Long enough to spare the one platform-wide Drive API key's quota across
// every visitor of every tenant's public page; short enough that an admin
// dropping new photos in before Sunday service still sees them show up
// the same morning, not next week.
const CACHE_TTL_SECONDS = 600;

// "A specified path, just updating pictures... always updated" — a public
// Google Drive folder link an admin pastes into a Pages Gallery section
// (GalleryContent.syncFolderUrl), listed here at render time instead of
// re-uploaded through the editor every week. Deliberately the "no OAuth,
// no connected account" shape: a single platform-wide, read-only API key
// (GOOGLE_DRIVE_API_KEY) rather than each tenant authorizing their own
// Drive account — the folder itself just needs "Anyone with the link can
// view" sharing turned on.
@Injectable()
export class GalleryFolderSyncService {
  private readonly logger = new Logger(GalleryFolderSyncService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly cacheService: CacheService,
  ) {}

  // A shape check only — no live API call — so PageService can validate a
  // syncFolderUrl at save time without GOOGLE_DRIVE_API_KEY needing to be
  // configured just to let an admin save the section.
  extractFolderId(url: string): string | null {
    return url.match(DRIVE_FOLDER_ID_PATTERN)?.[1] ?? null;
  }

  // Never throws — every failure mode (unset key, malformed url, folder
  // not actually public, quota, network) degrades to an empty list rather
  // than breaking the whole public page response. PageService.
  // withSyncedGalleryImages falls back to the section's manually-saved
  // `images` whenever this comes back empty.
  async listImages(
    folderUrl: string,
  ): Promise<{ url: string; caption: string }[]> {
    const folderId = this.extractFolderId(folderUrl);
    if (!folderId) return [];

    const apiKey = this.configService.get<string>('GOOGLE_DRIVE_API_KEY');
    if (!apiKey) {
      this.logger.warn(
        'GOOGLE_DRIVE_API_KEY is not configured — Gallery folder sync is disabled platform-wide',
      );
      return [];
    }

    return this.cacheService.getOrSet(
      this.cacheService.key('gallery_folder_sync', folderId),
      () => this.fetchFolderImages(folderId, apiKey),
      CACHE_TTL_SECONDS,
    );
  }

  private async fetchFolderImages(
    folderId: string,
    apiKey: string,
  ): Promise<{ url: string; caption: string }[]> {
    const query = encodeURIComponent(
      `'${folderId}' in parents and mimeType contains '${IMAGE_MIME_PREFIX}' and trashed = false`,
    );
    const url = `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)&key=${apiKey}`;
    try {
      const response = await fetch(url);
      if (!response.ok) {
        this.logger.warn(
          `Gallery folder sync failed for folder ${folderId}: HTTP ${response.status}`,
        );
        return [];
      }
      const body = (await response.json()) as {
        files?: { id: string; name: string }[];
      };
      return (body.files ?? []).map((file) => ({
        url: `https://drive.google.com/uc?export=view&id=${file.id}`,
        caption: file.name,
      }));
    } catch (err) {
      this.logger.warn(
        `Gallery folder sync request failed for folder ${folderId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return [];
    }
  }
}
