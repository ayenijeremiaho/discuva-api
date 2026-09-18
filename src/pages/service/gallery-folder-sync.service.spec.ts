import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { GalleryFolderSyncService } from './gallery-folder-sync.service';
import { CacheService } from '../../utility/service/cache.service';

const mockConfigService = {
  get: jest.fn(),
};
const mockCacheService = {
  key: jest.fn((...parts: string[]) => parts.join(':')),
  getOrSet: jest
    .fn()
    .mockImplementation((_key: string, fn: () => Promise<unknown>) => fn()),
};

describe('GalleryFolderSyncService', () => {
  let service: GalleryFolderSyncService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockConfigService.get.mockReturnValue('test-api-key');
    mockCacheService.getOrSet.mockImplementation(
      (_key: string, fn: () => Promise<unknown>) => fn(),
    );
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GalleryFolderSyncService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: CacheService, useValue: mockCacheService },
      ],
    }).compile();
    service = module.get(GalleryFolderSyncService);
  });

  describe('extractFolderId', () => {
    it('extracts the folder id from a real Drive share link', () => {
      expect(
        service.extractFolderId(
          'https://drive.google.com/drive/folders/1a2b3c4d5e?usp=sharing',
        ),
      ).toBe('1a2b3c4d5e');
    });

    it('returns null for a url with no /folders/ segment', () => {
      expect(
        service.extractFolderId('https://example.com/not-drive'),
      ).toBeNull();
    });
  });

  describe('listImages', () => {
    it('returns [] without calling fetch when the url has no folder id', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch');
      const result = await service.listImages('https://example.com/nope');
      expect(result).toEqual([]);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('returns [] without calling fetch when GOOGLE_DRIVE_API_KEY is unset', async () => {
      mockConfigService.get.mockReturnValue(undefined);
      const fetchSpy = jest.spyOn(global, 'fetch');
      const result = await service.listImages(
        'https://drive.google.com/drive/folders/abc123',
      );
      expect(result).toEqual([]);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('maps Drive files to {url, caption} on a successful response', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          files: [
            { id: 'f1', name: 'sunday.jpg' },
            { id: 'f2', name: 'choir.png' },
          ],
        }),
      } as Response);

      const result = await service.listImages(
        'https://drive.google.com/drive/folders/abc123',
      );

      expect(result).toEqual([
        {
          url: 'https://drive.google.com/uc?export=view&id=f1',
          caption: 'sunday.jpg',
        },
        {
          url: 'https://drive.google.com/uc?export=view&id=f2',
          caption: 'choir.png',
        },
      ]);
    });

    it('returns [] (not a thrown error) when the Drive API responds with a non-OK status', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 403,
      } as Response);

      const result = await service.listImages(
        'https://drive.google.com/drive/folders/abc123',
      );
      expect(result).toEqual([]);
    });

    it('returns [] (not a thrown error) when the request itself fails', async () => {
      jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'));

      const result = await service.listImages(
        'https://drive.google.com/drive/folders/abc123',
      );
      expect(result).toEqual([]);
    });

    it('caches the listing per folder id via CacheService.getOrSet', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ files: [] }),
      } as Response);

      await service.listImages('https://drive.google.com/drive/folders/abc123');

      expect(mockCacheService.key).toHaveBeenCalledWith(
        'gallery_folder_sync',
        'abc123',
      );
      expect(mockCacheService.getOrSet).toHaveBeenCalledWith(
        'gallery_folder_sync:abc123',
        expect.any(Function),
        600,
      );
    });
  });
});
