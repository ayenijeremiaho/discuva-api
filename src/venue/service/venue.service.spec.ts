import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { VenueService } from './venue.service';
import { Venue } from '../entity/venue.entity';
import { CacheService } from '../../utility/service/cache.service';
import { ConfigService } from '@nestjs/config';

const mockCacheService = {
  key: jest.fn().mockImplementation((ns: string, id: string) => `${ns}:${id}`),
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(1),
};

const mockConfigService = { get: jest.fn().mockReturnValue(300) };

const mockRepo = {
  findOneBy: jest.fn(),
  find: jest.fn(),
  save: jest.fn(),
  create: jest.fn(),
  remove: jest.fn(),
  exists: jest.fn(),
};

const mainAuditorium: Venue = {
  id: 'venue-1',
  name: 'Main Auditorium',
  address: '123 Church Road',
  latitude: 6.5244,
  longitude: 3.3792,
} as Venue;

const annexHall: Venue = {
  id: 'venue-2',
  name: 'Annex Hall',
  address: '456 Church Road',
  latitude: 6.6,
  longitude: 3.4,
} as Venue;

describe('VenueService', () => {
  let service: VenueService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockConfigService.get.mockReturnValue(300);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VenueService,
        { provide: getRepositoryToken(Venue), useValue: mockRepo },
        { provide: CacheService, useValue: mockCacheService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<VenueService>(VenueService);
  });

  describe('create', () => {
    it('creates a venue when the name is unique', async () => {
      const dto = {
        name: 'Main Auditorium',
        address: '123 Church Road',
        latitude: 6.5244,
        longitude: 3.3792,
      };
      mockRepo.exists.mockResolvedValue(false);
      mockRepo.create.mockReturnValue(dto);
      mockRepo.save.mockResolvedValue(mainAuditorium);

      const result = await service.create(dto);

      expect(mockRepo.exists).toHaveBeenCalledWith({
        where: { name: dto.name },
      });
      expect(mockCacheService.del).toHaveBeenCalledWith('venues:all');
      expect(result).toEqual(mainAuditorium);
    });

    it('throws ConflictException when the name already exists', async () => {
      mockRepo.exists.mockResolvedValue(true);

      await expect(
        service.create({
          name: 'Main Auditorium',
          latitude: 6.5244,
          longitude: 3.3792,
        }),
      ).rejects.toThrow(ConflictException);
      expect(mockRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('getAll', () => {
    it('returns the cached list without hitting the DB', async () => {
      mockCacheService.get.mockResolvedValue([mainAuditorium]);

      const result = await service.getAll();

      expect(mockRepo.find).not.toHaveBeenCalled();
      expect(result).toEqual([mainAuditorium]);
    });

    it('falls back to the DB and populates the cache on a miss', async () => {
      mockCacheService.get.mockResolvedValue(undefined);
      mockRepo.find.mockResolvedValue([mainAuditorium]);

      const result = await service.getAll();

      expect(mockRepo.find).toHaveBeenCalledWith({ order: { name: 'ASC' } });
      expect(mockCacheService.set).toHaveBeenCalledWith(
        'venues:all',
        [mainAuditorium],
        300,
      );
      expect(result).toEqual([mainAuditorium]);
    });
  });

  describe('getById', () => {
    it('returns the venue when found', async () => {
      mockRepo.findOneBy.mockResolvedValue(mainAuditorium);

      const result = await service.getById('venue-1');

      expect(result).toEqual(mainAuditorium);
    });

    it('throws NotFoundException when missing', async () => {
      mockRepo.findOneBy.mockResolvedValue(null);

      await expect(service.getById('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('applies partial field updates', async () => {
      mockRepo.findOneBy.mockResolvedValue({ ...mainAuditorium });
      mockRepo.save.mockImplementation((v) => Promise.resolve(v));

      const result = await service.update('venue-1', { address: 'New Rd' });

      expect(result.address).toBe('New Rd');
      expect(result.latitude).toBe(mainAuditorium.latitude);
      expect(mockCacheService.del).toHaveBeenCalledWith('venues:all');
    });

    it('applies latitude and longitude together', async () => {
      mockRepo.findOneBy.mockResolvedValue({ ...mainAuditorium });
      mockRepo.save.mockImplementation((v) => Promise.resolve(v));

      const result = await service.update('venue-1', {
        latitude: 7.1,
        longitude: 4.2,
      });

      expect(result.latitude).toBe(7.1);
      expect(result.longitude).toBe(4.2);
    });

    it('throws ConflictException when renaming to an existing name', async () => {
      mockRepo.findOneBy.mockResolvedValue({ ...mainAuditorium });
      mockRepo.exists.mockResolvedValue(true);

      await expect(
        service.update('venue-1', { name: 'Annex Hall' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('delete', () => {
    it('removes the venue and invalidates the cache', async () => {
      mockRepo.findOneBy.mockResolvedValue(mainAuditorium);
      mockRepo.remove.mockResolvedValue(undefined);

      await service.delete('venue-1');

      expect(mockRepo.remove).toHaveBeenCalledWith(mainAuditorium);
      expect(mockCacheService.del).toHaveBeenCalledWith('venues:all');
    });

    it('throws BadRequestException when referenced elsewhere', async () => {
      mockRepo.findOneBy.mockResolvedValue(mainAuditorium);
      mockRepo.remove.mockRejectedValue(new Error('FK violation'));

      await expect(service.delete('venue-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(mockCacheService.del).not.toHaveBeenCalled();
    });
  });

  describe('getNearby', () => {
    it('filters by radius, sorts by distance, and respects the limit', async () => {
      mockCacheService.get.mockResolvedValue([annexHall, mainAuditorium]);

      const result = await service.getNearby(6.5244, 3.3792, 50000, 10);

      expect(result[0].id).toBe('venue-1');
      expect(result[0].distanceMeters).toBeCloseTo(0, 0);
      expect(result[1].id).toBe('venue-2');
      expect(result[1].distanceMeters).toBeGreaterThan(0);
    });

    it('excludes venues outside the radius', async () => {
      mockCacheService.get.mockResolvedValue([mainAuditorium, annexHall]);

      const result = await service.getNearby(6.5244, 3.3792, 10, 10);

      expect(result).toEqual([
        expect.objectContaining({
          id: 'venue-1',
          distanceMeters: expect.any(Number),
        }),
      ]);
    });

    it('respects the limit', async () => {
      mockCacheService.get.mockResolvedValue([mainAuditorium, annexHall]);

      const result = await service.getNearby(6.5244, 3.3792, 50000, 1);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('venue-1');
    });
  });
});
