import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EventConfigService } from './event-config.service';
import { EventConfig } from '../entity/event-config.entity';
import { VenueService } from '../../venue/service/venue.service';
import { CacheService } from '../../utility/service/cache.service';
import { ConfigService } from '@nestjs/config';
import { MeetingFormatEnum } from '../../utility/enum/meeting-format.enum';

const mockCacheService = {
  key: jest.fn().mockImplementation((ns: string, id: string) => `${ns}:${id}`),
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(1),
};

const mockConfigService = { get: jest.fn() };

const mockRepo = {
  findOneBy: jest.fn(),
  findOne: jest.fn(),
  findAndCount: jest.fn(),
  save: jest.fn(),
  create: jest.fn(),
  remove: jest.fn(),
  exists: jest.fn(),
};

const mockVenueService = {
  getById: jest.fn(),
};

const defaultVenue = {
  id: 'venue-1',
  name: 'Main Auditorium',
  latitude: 6.5244,
  longitude: 3.3792,
};

const validDto = {
  name: 'Default Config',
  description: 'Standard Sunday config',
  defaultVenueId: 'venue-1',
  workerCheckinStartOffsetSeconds: -7200,
  workerLateOffsetSeconds: 0,
  memberCheckinStartOffsetSeconds: -3600,
  checkinStopOffsetSeconds: 7200,
  allowedDistanceInMeters: 100,
};

describe('EventConfigService', () => {
  let service: EventConfigService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventConfigService,
        { provide: getRepositoryToken(EventConfig), useValue: mockRepo },
        { provide: VenueService, useValue: mockVenueService },
        { provide: CacheService, useValue: mockCacheService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<EventConfigService>(EventConfigService);
  });

  describe('create', () => {
    it('should throw BadRequestException if name already exists', async () => {
      mockRepo.exists.mockResolvedValue(true);

      await expect(service.create(validDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if workerCheckinStartOffsetSeconds is not negative', async () => {
      mockRepo.exists.mockResolvedValue(false);

      await expect(
        service.create({ ...validDto, workerCheckinStartOffsetSeconds: 0 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if memberCheckinStartOffsetSeconds is not negative', async () => {
      mockRepo.exists.mockResolvedValue(false);

      await expect(
        service.create({ ...validDto, memberCheckinStartOffsetSeconds: 0 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if workerLateOffset <= workerCheckinStartOffset', async () => {
      mockRepo.exists.mockResolvedValue(false);

      await expect(
        service.create({
          ...validDto,
          workerCheckinStartOffsetSeconds: -100,
          workerLateOffsetSeconds: -200,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if checkinStopOffset <= workerLateOffset', async () => {
      mockRepo.exists.mockResolvedValue(false);
      mockVenueService.getById.mockResolvedValue(defaultVenue);

      await expect(
        service.create({
          ...validDto,
          workerCheckinStartOffsetSeconds: -7200,
          workerLateOffsetSeconds: 300,
          checkinStopOffsetSeconds: 100,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    // Regression test: this ordering rule was previously only checked
    // against workerLateOffsetSeconds — a config could pass every existing
    // check yet still leave members with an impossible window, since
    // nothing tied checkinStopOffsetSeconds to memberCheckinStartOffsetSeconds.
    it('should throw BadRequestException if checkinStopOffsetSeconds <= memberCheckinStartOffsetSeconds', async () => {
      mockRepo.exists.mockResolvedValue(false);
      mockVenueService.getById.mockResolvedValue(defaultVenue);

      await expect(
        service.create({
          ...validDto,
          workerCheckinStartOffsetSeconds: -600,
          workerLateOffsetSeconds: -30,
          checkinStopOffsetSeconds: -15,
          memberCheckinStartOffsetSeconds: -10,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should save config on valid input', async () => {
      mockRepo.exists.mockResolvedValue(false);
      mockVenueService.getById.mockResolvedValue(defaultVenue);
      const configObj = { ...validDto, id: 'config-1', defaultVenue };
      mockRepo.create.mockReturnValue(configObj);
      mockRepo.save.mockResolvedValue(configObj);

      const result = await service.create(validDto);

      expect(mockVenueService.getById).toHaveBeenCalledWith('venue-1');
      expect(mockRepo.save).toHaveBeenCalledWith(configObj);
      expect(result).toMatchObject({ id: 'config-1', name: validDto.name });
    });

    it('should throw BadRequestException when workerLateOffset equals workerCheckinStartOffset', async () => {
      mockRepo.exists.mockResolvedValue(false);
      mockVenueService.getById.mockResolvedValue(defaultVenue);

      await expect(
        service.create({
          ...validDto,
          workerCheckinStartOffsetSeconds: -3600,
          workerLateOffsetSeconds: -3600,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('defaults autoStartSession to false when not provided', async () => {
      mockRepo.exists.mockResolvedValue(false);
      mockVenueService.getById.mockResolvedValue(defaultVenue);
      mockRepo.create.mockReturnValue({});
      mockRepo.save.mockResolvedValue({});

      await service.create(validDto);

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ autoStartSession: false }),
      );
    });

    it('passes autoStartSession through when explicitly set to true', async () => {
      mockRepo.exists.mockResolvedValue(false);
      mockVenueService.getById.mockResolvedValue(defaultVenue);
      mockRepo.create.mockReturnValue({});
      mockRepo.save.mockResolvedValue({});

      await service.create({ ...validDto, autoStartSession: true });

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ autoStartSession: true }),
      );
    });

    it('defaults enforceMemberLocation to false when not provided', async () => {
      mockRepo.exists.mockResolvedValue(false);
      mockVenueService.getById.mockResolvedValue(defaultVenue);
      mockRepo.create.mockReturnValue({});
      mockRepo.save.mockResolvedValue({});

      await service.create(validDto);

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ enforceMemberLocation: false }),
      );
    });

    it('passes enforceMemberLocation through when explicitly set to true', async () => {
      mockRepo.exists.mockResolvedValue(false);
      mockVenueService.getById.mockResolvedValue(defaultVenue);
      mockRepo.create.mockReturnValue({});
      mockRepo.save.mockResolvedValue({});

      await service.create({ ...validDto, enforceMemberLocation: true });

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ enforceMemberLocation: true }),
      );
    });

    it('throws BadRequestException for an IN_PERSON config with no defaultVenueId', async () => {
      mockRepo.exists.mockResolvedValue(false);
      const { defaultVenueId: _dv, ...dtoWithoutVenue } = validDto;

      await expect(
        service.create({
          ...dtoWithoutVenue,
          defaultFormat: MeetingFormatEnum.IN_PERSON,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockVenueService.getById).not.toHaveBeenCalled();
    });

    it('throws BadRequestException for an ONLINE config that still has a defaultVenueId', async () => {
      mockRepo.exists.mockResolvedValue(false);

      await expect(
        service.create({
          ...validDto,
          defaultFormat: MeetingFormatEnum.ONLINE,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('saves an ONLINE config with no venue and an onlineMeetingUrl', async () => {
      mockRepo.exists.mockResolvedValue(false);
      const { defaultVenueId: _dv, ...dtoWithoutVenue } = validDto;
      mockRepo.create.mockReturnValue({});
      mockRepo.save.mockResolvedValue({});

      await service.create({
        ...dtoWithoutVenue,
        defaultFormat: MeetingFormatEnum.ONLINE,
        onlineMeetingUrl: 'https://zoom.example/live',
      });

      expect(mockVenueService.getById).not.toHaveBeenCalled();
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultVenue: null,
          defaultFormat: MeetingFormatEnum.ONLINE,
          onlineMeetingUrl: 'https://zoom.example/live',
        }),
      );
    });
  });

  describe('delete', () => {
    it('should throw NotFoundException if config not found', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(service.delete('nonexistent-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if config has assigned service slots', async () => {
      const config = {
        id: 'config-1',
        name: 'Default Config',
        serviceSlots: [{ id: 'slot-1' }, { id: 'slot-2' }],
      };
      mockRepo.findOne.mockResolvedValue(config);

      await expect(service.delete('config-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should remove config when no slots are assigned', async () => {
      const config = {
        id: 'config-1',
        name: 'Default Config',
        serviceSlots: [],
      };
      mockRepo.findOne.mockResolvedValue(config);
      mockRepo.remove.mockResolvedValue(undefined);

      await service.delete('config-1');

      expect(mockRepo.remove).toHaveBeenCalledWith(config);
    });
  });

  describe('update', () => {
    const validOffsets = {
      workerCheckinStartOffsetSeconds: -7200,
      workerLateOffsetSeconds: 0,
      memberCheckinStartOffsetSeconds: -3600,
      checkinStopOffsetSeconds: 7200,
    };

    it('should throw NotFoundException if config to update is not found', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(
        service.update('nonexistent', { name: 'New Name' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if new name conflicts with existing config', async () => {
      const existingConfig = {
        id: 'config-1',
        name: 'Old Name',
        defaultVenue,
        ...validOffsets,
      };
      mockRepo.findOne.mockResolvedValue(existingConfig);
      mockRepo.exists.mockResolvedValue(true);

      await expect(
        service.update('config-1', { name: 'Taken Name' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should update config successfully when no conflicts', async () => {
      const existingConfig = {
        id: 'config-1',
        name: 'Old Name',
        description: 'Old desc',
        defaultVenue,
        ...validOffsets,
      };
      mockRepo.findOne.mockResolvedValue(existingConfig);
      mockRepo.exists.mockResolvedValue(false);
      mockRepo.save.mockResolvedValue({ ...existingConfig, name: 'New Name' });

      const result = await service.update('config-1', { name: 'New Name' });

      expect(mockRepo.save).toHaveBeenCalled();
      expect(result.name).toBe('New Name');
    });

    it('should allow updating other fields without changing name', async () => {
      const existingConfig = {
        id: 'config-1',
        name: 'Same Name',
        allowedDistanceInMeters: 100,
        defaultVenue,
        ...validOffsets,
      };
      mockRepo.findOne.mockResolvedValue(existingConfig);
      mockRepo.save.mockResolvedValue({
        ...existingConfig,
        allowedDistanceInMeters: 200,
      });

      const result = await service.update('config-1', {
        allowedDistanceInMeters: 200,
      });

      expect(mockRepo.exists).not.toHaveBeenCalled();
      expect(result.allowedDistanceInMeters).toBe(200);
    });

    it('should allow toggling autoStartSession', async () => {
      const existingConfig = {
        id: 'config-1',
        name: 'Same Name',
        allowedDistanceInMeters: 100,
        autoStartSession: false,
        defaultVenue,
        ...validOffsets,
      };
      mockRepo.findOne.mockResolvedValue(existingConfig);
      mockRepo.save.mockResolvedValue({
        ...existingConfig,
        autoStartSession: true,
      });

      const result = await service.update('config-1', {
        autoStartSession: true,
      });

      expect(result.autoStartSession).toBe(true);
    });

    it('should update defaultVenue when defaultVenueId is provided', async () => {
      const newVenue = {
        id: 'venue-2',
        name: 'Chapel',
        latitude: 6.5,
        longitude: 3.4,
      };
      const existingConfig = {
        id: 'config-1',
        name: 'Config',
        defaultVenue,
        ...validOffsets,
      };
      mockRepo.findOne.mockResolvedValue(existingConfig);
      mockVenueService.getById.mockResolvedValue(newVenue);
      mockRepo.save.mockResolvedValue({
        ...existingConfig,
        defaultVenue: newVenue,
      });

      const result = await service.update('config-1', {
        defaultVenueId: 'venue-2',
      });

      expect(mockVenueService.getById).toHaveBeenCalledWith('venue-2');
      expect(result.defaultVenue).toEqual(newVenue);
    });

    it('should throw BadRequestException if updated workerCheckinStartOffsetSeconds is not negative', async () => {
      const existingConfig = {
        id: 'config-1',
        name: 'Config',
        defaultVenue,
        ...validOffsets,
      };
      mockRepo.findOne.mockResolvedValue(existingConfig);

      await expect(
        service.update('config-1', { workerCheckinStartOffsetSeconds: 0 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if updated memberCheckinStartOffsetSeconds is not negative', async () => {
      const existingConfig = {
        id: 'config-1',
        name: 'Config',
        defaultVenue,
        ...validOffsets,
      };
      mockRepo.findOne.mockResolvedValue(existingConfig);

      await expect(
        service.update('config-1', { memberCheckinStartOffsetSeconds: 100 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if updated offsets create invalid ordering', async () => {
      const existingConfig = {
        id: 'config-1',
        name: 'Config',
        defaultVenue,
        ...validOffsets,
      };
      mockRepo.findOne.mockResolvedValue(existingConfig);

      await expect(
        service.update('config-1', { workerLateOffsetSeconds: 8000 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('clears defaultVenue and switches to ONLINE when defaultVenueId is explicitly null', async () => {
      const existingConfig = {
        id: 'config-1',
        name: 'Config',
        defaultVenue,
        defaultFormat: MeetingFormatEnum.IN_PERSON,
        ...validOffsets,
      };
      mockRepo.findOne.mockResolvedValue(existingConfig);
      mockRepo.save.mockResolvedValue({
        ...existingConfig,
        defaultVenue: null,
        defaultFormat: MeetingFormatEnum.ONLINE,
      });

      const result = await service.update('config-1', {
        defaultVenueId: null,
        defaultFormat: MeetingFormatEnum.ONLINE,
      });

      expect(mockVenueService.getById).not.toHaveBeenCalled();
      expect(result.defaultVenue).toBeNull();
    });

    it('throws BadRequestException when clearing defaultVenueId while staying IN_PERSON', async () => {
      const existingConfig = {
        id: 'config-1',
        name: 'Config',
        defaultVenue,
        defaultFormat: MeetingFormatEnum.IN_PERSON,
        ...validOffsets,
      };
      mockRepo.findOne.mockResolvedValue(existingConfig);

      await expect(
        service.update('config-1', { defaultVenueId: null }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when switching to ONLINE without clearing an existing defaultVenue', async () => {
      const existingConfig = {
        id: 'config-1',
        name: 'Config',
        defaultVenue,
        defaultFormat: MeetingFormatEnum.IN_PERSON,
        ...validOffsets,
      };
      mockRepo.findOne.mockResolvedValue(existingConfig);

      await expect(
        service.update('config-1', { defaultFormat: MeetingFormatEnum.ONLINE }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('get', () => {
    it('should throw NotFoundException when config not found', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(service.get('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should return config with defaultVenue when found', async () => {
      const config = { id: 'config-1', name: 'Default Config', defaultVenue };
      mockRepo.findOne.mockResolvedValue(config);

      const result = await service.get('config-1');

      expect(mockRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'config-1' },
        relations: ['defaultVenue'],
      });
      expect(result).toEqual(config);
    });
  });
});
