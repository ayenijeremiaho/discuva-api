import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ClassTypesService } from './class-types.service';
import { ClassType } from '../entity/class-type.entity';
import { ChurchClass } from '../entity/church-class.entity';
import { CacheService } from '../../utility/service/cache.service';

const mockClassTypeRepo = {
  findOne: jest.fn(),
  find: jest.fn(),
  save: jest.fn(),
  create: jest.fn(),
  remove: jest.fn(),
};

const mockClassRepo = {
  count: jest.fn(),
};

const mockCacheService = {
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(1),
};

describe('ClassTypesService', () => {
  let service: ClassTypesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCacheService.get.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClassTypesService,
        {
          provide: getRepositoryToken(ClassType),
          useValue: mockClassTypeRepo,
        },
        { provide: getRepositoryToken(ChurchClass), useValue: mockClassRepo },
        { provide: CacheService, useValue: mockCacheService },
      ],
    }).compile();

    service = module.get<ClassTypesService>(ClassTypesService);
  });

  describe('createClassType', () => {
    it('creates a standalone type when no nextClassTypeId is given', async () => {
      const created = { id: 'ct-1', name: 'Baptismal Class' };
      mockClassTypeRepo.create.mockReturnValue(created);
      mockClassTypeRepo.save.mockResolvedValue(created);

      const result = await service.createClassType({ name: 'Baptismal Class' });

      expect(mockClassTypeRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Baptismal Class',
          nextClassType: null,
        }),
      );
      expect(result).toEqual(created);
      expect(mockCacheService.del).toHaveBeenCalled();
    });

    it('throws NotFoundException when nextClassTypeId does not exist', async () => {
      mockClassTypeRepo.findOne.mockResolvedValue(null);

      await expect(
        service.createClassType({
          name: 'Believers',
          nextClassTypeId: 'missing',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('wires up a valid nextClassType', async () => {
      const next = { id: 'ct-2', name: 'Workers in Training' };
      mockClassTypeRepo.findOne.mockResolvedValue(next);
      mockClassTypeRepo.create.mockImplementation((x) => x);
      mockClassTypeRepo.save.mockImplementation((x) =>
        Promise.resolve({ id: 'ct-1', ...x }),
      );

      const result = await service.createClassType({
        name: 'Believers',
        nextClassTypeId: 'ct-2',
      });

      expect(result.nextClassType).toEqual(next);
    });
  });

  describe('updateClassType', () => {
    it('throws NotFoundException if class type does not exist', async () => {
      mockClassTypeRepo.findOne.mockResolvedValue(null);

      await expect(
        service.updateClassType('missing', { name: 'X' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException on self-reference', async () => {
      mockClassTypeRepo.findOne.mockResolvedValue({
        id: 'ct-1',
        name: 'Believers',
      });

      await expect(
        service.updateClassType('ct-1', { nextClassTypeId: 'ct-1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when the new chain would cycle back to self', async () => {
      // ct-1 -> (proposed) ct-2 -> ct-1, a cycle
      mockClassTypeRepo.findOne
        .mockResolvedValueOnce({ id: 'ct-1', name: 'Believers' }) // getClassTypeOrThrow
        .mockResolvedValueOnce({ id: 'ct-2', name: 'Workers in Training' }) // resolveNextClassType's existence check
        .mockResolvedValueOnce({
          id: 'ct-2',
          nextClassType: { id: 'ct-1' },
        }); // chain walk step

      await expect(
        service.updateClassType('ct-1', { nextClassTypeId: 'ct-2' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('updates fields and clears the cache', async () => {
      const existing = {
        id: 'ct-1',
        name: 'Old Name',
        description: null,
        isActive: true,
        nextClassType: null,
      };
      mockClassTypeRepo.findOne.mockResolvedValue(existing);
      mockClassTypeRepo.save.mockImplementation((x) => Promise.resolve(x));

      const result = await service.updateClassType('ct-1', {
        name: 'New Name',
        isActive: false,
      });

      expect(result.name).toBe('New Name');
      expect(result.isActive).toBe(false);
      expect(mockCacheService.del).toHaveBeenCalled();
    });
  });

  describe('deleteClassType', () => {
    it('throws BadRequestException when classes still reference it', async () => {
      mockClassTypeRepo.findOne.mockResolvedValue({ id: 'ct-1', name: 'X' });
      mockClassRepo.count.mockResolvedValue(3);

      await expect(service.deleteClassType('ct-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(mockClassTypeRepo.remove).not.toHaveBeenCalled();
    });

    it('deletes when no classes reference it', async () => {
      const classType = { id: 'ct-1', name: 'X' };
      mockClassTypeRepo.findOne.mockResolvedValue(classType);
      mockClassRepo.count.mockResolvedValue(0);

      await service.deleteClassType('ct-1');

      expect(mockClassTypeRepo.remove).toHaveBeenCalledWith(classType);
      expect(mockCacheService.del).toHaveBeenCalled();
    });
  });

  describe('getAllClassTypes', () => {
    it('returns cached value without hitting the repo when present', async () => {
      const cached = [{ id: 'ct-1' }];
      mockCacheService.get.mockResolvedValue(cached);

      const result = await service.getAllClassTypes();

      expect(result).toEqual(cached);
      expect(mockClassTypeRepo.find).not.toHaveBeenCalled();
    });

    it('fetches and caches on a miss', async () => {
      mockCacheService.get.mockResolvedValue(undefined);
      const all = [{ id: 'ct-1' }, { id: 'ct-2' }];
      mockClassTypeRepo.find.mockResolvedValue(all);

      const result = await service.getAllClassTypes();

      expect(result).toEqual(all);
      expect(mockCacheService.set).toHaveBeenCalled();
    });
  });
});
