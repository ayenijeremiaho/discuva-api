import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ChurchCalendarService } from './church-calendar.service';
import { ChurchCalendar } from '../entity/church-calendar.entity';
import { CloudinaryService } from '../../utility/service/cloudinary.service';
import { DateService } from '../../utility/service/date.service';
import { CreateChurchCalendarDto } from '../dto/church-calendar.dto';

const mockCalendarRepo = {
  create: jest.fn((v) => v),
  save: jest.fn((v) => Promise.resolve({ id: 'calendar-1', ...v })),
  find: jest.fn(),
  findOneBy: jest.fn(),
  remove: jest.fn(),
};
const mockCloudinaryService = {
  uploadBuffer: jest.fn(),
};
const mockDateService = {
  today: jest.fn(),
};

describe('ChurchCalendarService', () => {
  let service: ChurchCalendarService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChurchCalendarService,
        {
          provide: getRepositoryToken(ChurchCalendar),
          useValue: mockCalendarRepo,
        },
        { provide: CloudinaryService, useValue: mockCloudinaryService },
        { provide: DateService, useValue: mockDateService },
      ],
    }).compile();
    service = module.get(ChurchCalendarService);
  });

  function makeDto(
    overrides: Partial<CreateChurchCalendarDto> = {},
  ): CreateChurchCalendarDto {
    return {
      title: 'September Programme',
      theme: 'REMEMBERED',
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      entries: [
        { id: 'e1', date: '2026-09-13', title: 'Appreciation Service' },
        { id: 'e2', date: '2026-09-06', title: 'Thanksgiving Service' },
      ],
      ...overrides,
    };
  }

  describe('create', () => {
    it('creates a calendar with entries sorted by date, regardless of input order', async () => {
      const result = await service.create(makeDto());

      expect(mockCalendarRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          entries: [
            expect.objectContaining({ date: '2026-09-06' }),
            expect.objectContaining({ date: '2026-09-13' }),
          ],
        }),
      );
      expect(result.id).toBe('calendar-1');
    });

    it('rejects an entry whose date falls before startDate', async () => {
      await expect(
        service.create(
          makeDto({
            entries: [{ id: 'e1', date: '2026-08-31', title: 'Too early' }],
          }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an entry whose date falls after endDate', async () => {
      await expect(
        service.create(
          makeDto({
            entries: [{ id: 'e1', date: '2026-10-01', title: 'Too late' }],
          }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an entry with a blank title', async () => {
      await expect(
        service.create(
          makeDto({
            entries: [{ id: 'e1', date: '2026-09-10', title: '   ' }],
          }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects endDate before startDate', async () => {
      await expect(
        service.create(
          makeDto({ startDate: '2026-09-30', endDate: '2026-09-01' }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('defaults theme/accentColor to null and isPublished to false when omitted', async () => {
      await service.create(
        makeDto({ theme: undefined, isPublished: undefined }),
      );

      expect(mockCalendarRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          theme: null,
          accentColor: null,
          isPublished: false,
        }),
      );
    });
  });

  describe('getCurrentForMember', () => {
    it('queries only published calendars whose endDate has not passed, ordered earliest first', async () => {
      mockDateService.today.mockReturnValue('2026-09-15');
      mockCalendarRepo.find.mockResolvedValue([]);

      await service.getCurrentForMember();

      expect(mockCalendarRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isPublished: true }),
          order: { startDate: 'ASC' },
        }),
      );
    });
  });

  describe('update', () => {
    it('throws NotFoundException for an unknown calendar', async () => {
      mockCalendarRepo.findOneBy.mockResolvedValue(null);
      await expect(service.update('missing', { title: 'x' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('re-validates entries against the existing date range when only entries change', async () => {
      mockCalendarRepo.findOneBy.mockResolvedValue({
        id: 'calendar-1',
        startDate: '2026-09-01',
        endDate: '2026-09-30',
        entries: [],
      });

      await expect(
        service.update('calendar-1', {
          entries: [{ id: 'e1', date: '2026-10-05', title: 'Out of range' }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('re-validates entries against a newly-narrowed date range in the same update', async () => {
      mockCalendarRepo.findOneBy.mockResolvedValue({
        id: 'calendar-1',
        startDate: '2026-09-01',
        endDate: '2026-09-30',
        entries: [],
      });

      await expect(
        service.update('calendar-1', {
          endDate: '2026-09-10',
          entries: [
            { id: 'e1', date: '2026-09-20', title: 'Now out of range' },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('leaves fields not present in the dto untouched', async () => {
      mockCalendarRepo.findOneBy.mockResolvedValue({
        id: 'calendar-1',
        title: 'September Programme',
        theme: 'REMEMBERED',
        startDate: '2026-09-01',
        endDate: '2026-09-30',
        entries: [],
      });

      await service.update('calendar-1', { isPublished: true });

      expect(mockCalendarRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'September Programme',
          theme: 'REMEMBERED',
          isPublished: true,
        }),
      );
    });
  });

  describe('delete', () => {
    it('removes the calendar', async () => {
      mockCalendarRepo.findOneBy.mockResolvedValue({ id: 'calendar-1' });
      await service.delete('calendar-1');
      expect(mockCalendarRepo.remove).toHaveBeenCalledWith({
        id: 'calendar-1',
      });
    });
  });

  describe('uploadEntryImage', () => {
    it('uploads to the church-calendar-images folder and returns a url/publicId reference only', async () => {
      mockCalendarRepo.findOneBy.mockResolvedValue({ id: 'calendar-1' });
      mockCloudinaryService.uploadBuffer.mockResolvedValue({
        secureUrl: 'https://cdn.example.com/photo.jpg',
        publicId: 'church-calendar-images/abc',
      });

      const result = await service.uploadEntryImage('calendar-1', {
        buffer: Buffer.from('x'),
        mimetype: 'image/jpeg',
      } as Express.Multer.File);

      expect(mockCloudinaryService.uploadBuffer).toHaveBeenCalledWith(
        expect.any(Buffer),
        'church-calendar-images',
        undefined,
        'image/jpeg',
      );
      expect(result).toEqual({
        url: 'https://cdn.example.com/photo.jpg',
        publicId: 'church-calendar-images/abc',
      });
    });

    it('throws NotFoundException when the calendar does not exist', async () => {
      mockCalendarRepo.findOneBy.mockResolvedValue(null);
      await expect(
        service.uploadEntryImage('missing', {} as Express.Multer.File),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
