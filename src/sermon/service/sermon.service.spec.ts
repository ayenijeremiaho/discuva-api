import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';

// AnnouncementService transitively imports SanitizationService, which pulls
// in jsdom — mocked here (as announcement.service.spec.ts does) so this
// spec doesn't need jsdom's ESM-only transitive deps just to get a DI token.
jest.mock('../../utility/service/sanitization.service', () => ({
  SanitizationService: jest.fn().mockImplementation(() => ({
    sanitize: jest.fn((html: string) => html),
    sanitizeText: jest.fn((text: string) => text),
    sanitizeForEmail: jest.fn((html: string) => html),
  })),
}));

import { SermonService } from './sermon.service';
import { Sermon } from '../entity/sermon.entity';
import { SermonNote } from '../entity/sermon-note.entity';
import { LivePlatformEnum } from '../enum/live-platform.enum';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { AnnouncementService } from '../../announcement/service/announcement.service';

const mockAdmin = { id: 'admin-1' } as any;

const mockSermonRepo = {
  create: jest.fn(),
  save: jest.fn(),
  remove: jest.fn(),
  findOne: jest.fn(),
  findAndCount: jest.fn(),
};

const mockSermonNoteRepo = {
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  delete: jest.fn(),
};

const mockAuditLogService = {
  log: jest.fn(),
};

const mockAnnouncementService = {
  createSystemAnnouncement: jest.fn().mockResolvedValue({ id: 'ann-1' }),
};

describe('SermonService', () => {
  let service: SermonService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SermonService,
        { provide: getRepositoryToken(Sermon), useValue: mockSermonRepo },
        {
          provide: getRepositoryToken(SermonNote),
          useValue: mockSermonNoteRepo,
        },
        { provide: AuditLogService, useValue: mockAuditLogService },
        { provide: AnnouncementService, useValue: mockAnnouncementService },
      ],
    }).compile();

    service = module.get(SermonService);
  });

  describe('create', () => {
    it('throws BadRequestException when neither youtubeUrl nor mixlrUrl is provided', async () => {
      await expect(
        service.create(
          { title: 'T', speakerName: 'S', date: '2026-01-01' } as any,
          mockAdmin,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates a sermon and logs SERMON_CREATED', async () => {
      const saved = { id: 'sermon-1', title: 'T' };
      mockSermonRepo.create.mockReturnValue(saved);
      mockSermonRepo.save.mockResolvedValue(saved);

      const result = await service.create(
        {
          title: 'T',
          speakerName: 'S',
          date: '2026-01-01',
          youtubeUrl: 'https://youtube.com/watch?v=abc',
        } as any,
        mockAdmin,
      );

      expect(mockSermonRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'T', createdBy: { id: 'admin-1' } }),
      );
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'SERMON_CREATED',
        expect.objectContaining({ actorId: 'admin-1', targetId: 'sermon-1' }),
      );
      expect(result).toBe(saved);
    });
  });

  describe('update', () => {
    it('throws NotFoundException when the sermon does not exist', async () => {
      mockSermonRepo.findOne.mockResolvedValue(null);
      await expect(
        service.update('missing', { title: 'New' } as any, mockAdmin),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException if the update would clear both links', async () => {
      mockSermonRepo.findOne.mockResolvedValue({
        id: 'sermon-1',
        youtubeUrl: 'https://youtube.com/x',
        mixlrUrl: null,
      });

      await expect(
        service.update('sermon-1', { youtubeUrl: '' } as any, mockAdmin),
      ).rejects.toThrow(BadRequestException);
    });

    it('updates fields and logs SERMON_UPDATED', async () => {
      const existing = {
        id: 'sermon-1',
        title: 'Old',
        youtubeUrl: 'https://youtube.com/x',
        mixlrUrl: null,
      };
      mockSermonRepo.findOne.mockResolvedValue(existing);
      mockSermonRepo.save.mockResolvedValue({ ...existing, title: 'New' });

      const result = await service.update(
        'sermon-1',
        { title: 'New' } as any,
        mockAdmin,
      );

      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'SERMON_UPDATED',
        expect.objectContaining({ actorId: 'admin-1', targetId: 'sermon-1' }),
      );
      expect(result.title).toBe('New');
    });
  });

  describe('delete', () => {
    it('throws NotFoundException when the sermon does not exist', async () => {
      mockSermonRepo.findOne.mockResolvedValue(null);
      await expect(service.delete('missing', mockAdmin)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('removes the sermon and logs SERMON_DELETED', async () => {
      const existing = { id: 'sermon-1', title: 'T' };
      mockSermonRepo.findOne.mockResolvedValue(existing);

      await service.delete('sermon-1', mockAdmin);

      expect(mockSermonRepo.remove).toHaveBeenCalledWith(existing);
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'SERMON_DELETED',
        expect.objectContaining({ actorId: 'admin-1', targetId: 'sermon-1' }),
      );
    });
  });

  describe('findAll', () => {
    it('paginates and filters by series when provided', async () => {
      mockSermonRepo.findAndCount.mockResolvedValue([[{ id: 's1' }], 1]);

      const result = await service.findAll(1, 20, 'Faith Series');

      expect(mockSermonRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: { series: 'Faith Series' } }),
      );
      expect(result.totalCount).toBe(1);
    });
  });

  describe('announceLive', () => {
    it('builds a default title per platform and delegates to createSystemAnnouncement', async () => {
      await service.announceLive(
        {
          platform: LivePlatformEnum.YOUTUBE,
          url: 'https://youtube.com/live/abc',
        } as any,
        mockAdmin,
      );

      expect(
        mockAnnouncementService.createSystemAnnouncement,
      ).toHaveBeenCalledWith(
        '🔴 Live Now on YouTube',
        expect.stringContaining('https://youtube.com/live/abc'),
        'admin-1',
      );
    });

    it('uses a custom title when provided', async () => {
      await service.announceLive(
        {
          platform: LivePlatformEnum.MIXLR,
          url: 'https://mixlr.com/x',
          title: 'Custom Title',
        } as any,
        mockAdmin,
      );

      expect(
        mockAnnouncementService.createSystemAnnouncement,
      ).toHaveBeenCalledWith('Custom Title', expect.any(String), 'admin-1');
    });
  });

  describe('getMyNote', () => {
    it('throws NotFoundException when the sermon does not exist', async () => {
      mockSermonRepo.findOne.mockResolvedValue(null);
      await expect(service.getMyNote('missing', 'member-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns null when the member has no note for this sermon', async () => {
      mockSermonRepo.findOne.mockResolvedValue({ id: 'sermon-1' });
      mockSermonNoteRepo.findOne.mockResolvedValue(null);

      const result = await service.getMyNote('sermon-1', 'member-1');
      expect(result).toBeNull();
    });

    it('returns the existing note when one exists', async () => {
      mockSermonRepo.findOne.mockResolvedValue({ id: 'sermon-1' });
      const note = { id: 'note-1', note: 'Great message' };
      mockSermonNoteRepo.findOne.mockResolvedValue(note);

      const result = await service.getMyNote('sermon-1', 'member-1');
      expect(result).toBe(note);
    });
  });

  describe('upsertMyNote', () => {
    it('creates a new note when none exists yet', async () => {
      mockSermonRepo.findOne.mockResolvedValue({ id: 'sermon-1' });
      mockSermonNoteRepo.findOne.mockResolvedValue(null);
      const created = { note: 'My thoughts' };
      mockSermonNoteRepo.create.mockReturnValue(created);
      mockSermonNoteRepo.save.mockResolvedValue({ id: 'note-1', ...created });

      const result = await service.upsertMyNote('sermon-1', 'member-1', {
        note: 'My thoughts',
      });

      expect(mockSermonNoteRepo.create).toHaveBeenCalledWith({
        sermon: { id: 'sermon-1' },
        member: { id: 'member-1' },
        note: 'My thoughts',
      });
      expect(result).toEqual({ id: 'note-1', note: 'My thoughts' });
    });

    it('edits the existing note in place instead of creating a duplicate', async () => {
      mockSermonRepo.findOne.mockResolvedValue({ id: 'sermon-1' });
      const existing = { id: 'note-1', note: 'Old note' };
      mockSermonNoteRepo.findOne.mockResolvedValue(existing);
      mockSermonNoteRepo.save.mockImplementation((n) => Promise.resolve(n));

      const result = await service.upsertMyNote('sermon-1', 'member-1', {
        note: 'Updated note',
      });

      expect(mockSermonNoteRepo.create).not.toHaveBeenCalled();
      expect(result.note).toBe('Updated note');
    });
  });

  describe('deleteMyNote', () => {
    it('deletes the note scoped to the sermon and member', async () => {
      await service.deleteMyNote('sermon-1', 'member-1');

      expect(mockSermonNoteRepo.delete).toHaveBeenCalledWith({
        sermon: { id: 'sermon-1' },
        member: { id: 'member-1' },
      });
    });
  });
});
