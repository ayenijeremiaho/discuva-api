import { Test, TestingModule } from '@nestjs/testing';
import { VenueController } from './venue.controller';
import { VenueService } from '../service/venue.service';
import { AdminGuard } from '../../admin/guard/admin.guard';

const mockVenueService = {
  create: jest.fn(),
  getAll: jest.fn(),
  getNearby: jest.fn(),
  getById: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
};

describe('VenueController', () => {
  let controller: VenueController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [VenueController],
      providers: [{ provide: VenueService, useValue: mockVenueService }],
    })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<VenueController>(VenueController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('delegates to service', async () => {
      const dto = {
        name: 'Main Auditorium',
        latitude: 6.5244,
        longitude: 3.3792,
      };
      const venue = { id: 'venue-1', ...dto };
      mockVenueService.create.mockResolvedValue(venue);

      const result = await controller.create(dto as any);

      expect(mockVenueService.create).toHaveBeenCalledWith(dto);
      expect(result).toEqual(venue);
    });
  });

  describe('getAll', () => {
    it('delegates to service', async () => {
      const venues = [{ id: 'venue-1', name: 'Main Auditorium' }];
      mockVenueService.getAll.mockResolvedValue(venues);

      const result = await controller.getAll();

      expect(mockVenueService.getAll).toHaveBeenCalledWith();
      expect(result).toEqual(venues);
    });
  });

  describe('getNearby', () => {
    it('delegates to service with the parsed query params', async () => {
      const query = {
        latitude: 6.5244,
        longitude: 3.3792,
        radiusMeters: 5000,
        limit: 10,
      };
      const venues = [{ id: 'venue-1', distanceMeters: 0 }];
      mockVenueService.getNearby.mockResolvedValue(venues);

      const result = await controller.getNearby(query as any);

      expect(mockVenueService.getNearby).toHaveBeenCalledWith(
        query.latitude,
        query.longitude,
        query.radiusMeters,
        query.limit,
      );
      expect(result).toEqual(venues);
    });
  });

  describe('getById', () => {
    it('delegates to service', async () => {
      const venue = { id: 'venue-1', name: 'Main Auditorium' };
      mockVenueService.getById.mockResolvedValue(venue);

      const result = await controller.getById('venue-1');

      expect(mockVenueService.getById).toHaveBeenCalledWith('venue-1');
      expect(result).toEqual(venue);
    });
  });

  describe('update', () => {
    it('delegates to service', async () => {
      const dto = { address: 'New Rd' };
      const venue = { id: 'venue-1', address: 'New Rd' };
      mockVenueService.update.mockResolvedValue(venue);

      const result = await controller.update('venue-1', dto as any);

      expect(mockVenueService.update).toHaveBeenCalledWith('venue-1', dto);
      expect(result).toEqual(venue);
    });
  });

  describe('delete', () => {
    it('delegates to service', async () => {
      mockVenueService.delete.mockResolvedValue(undefined);

      const result = await controller.delete('venue-1');

      expect(mockVenueService.delete).toHaveBeenCalledWith('venue-1');
      expect(result).toBeUndefined();
    });
  });
});
