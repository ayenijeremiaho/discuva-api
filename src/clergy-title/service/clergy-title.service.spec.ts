import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClergyTitleService } from './clergy-title.service';
import { ClergyTitle } from '../entity/clergy-title.entity';
import { Clergy } from '../../member/entity/clergy.entity';
import { CacheService } from '../../utility/service/cache.service';
import { AuditLogService } from '../../utility/service/audit-log.service';

const mockCacheService = {
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(1),
};
const mockConfigService = { get: jest.fn() };
const mockAuditLogService = { log: jest.fn() };

const mockClergyTitleRepo = {
  save: jest.fn(),
  find: jest.fn(),
  findOneBy: jest.fn(),
  existsBy: jest.fn(),
  delete: jest.fn(),
};

const mockClergyRepo = {
  exists: jest.fn(),
};

describe('ClergyTitleService', () => {
  let service: ClergyTitleService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClergyTitleService,
        {
          provide: getRepositoryToken(ClergyTitle),
          useValue: mockClergyTitleRepo,
        },
        { provide: getRepositoryToken(Clergy), useValue: mockClergyRepo },
        { provide: CacheService, useValue: mockCacheService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: AuditLogService, useValue: mockAuditLogService },
      ],
    }).compile();

    service = module.get(ClergyTitleService);
  });

  describe('create', () => {
    it('creates a title when the name is unused', async () => {
      mockClergyTitleRepo.existsBy.mockResolvedValue(false);
      mockClergyTitleRepo.save.mockResolvedValue({
        id: 'title-1',
        name: 'Priest',
      });

      const result = await service.create({ name: 'Priest' }, 'actor-1');

      expect(mockCacheService.del).toHaveBeenCalledWith('clergy-titles:all');
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'CLERGY_TITLE_CREATED',
        expect.objectContaining({ actorId: 'actor-1', targetId: 'title-1' }),
      );
      expect(result).toEqual({ id: 'title-1', name: 'Priest' });
    });

    it('throws when the name already exists', async () => {
      mockClergyTitleRepo.existsBy.mockResolvedValue(true);
      await expect(
        service.create({ name: 'Priest' }, 'actor-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getAll', () => {
    it('returns cached results without hitting the repository', async () => {
      mockCacheService.get.mockResolvedValue([{ id: 'title-1' }]);
      const result = await service.getAll();
      expect(result).toEqual([{ id: 'title-1' }]);
      expect(mockClergyTitleRepo.find).not.toHaveBeenCalled();
    });

    it('queries and caches on a miss', async () => {
      mockCacheService.get.mockResolvedValue(undefined);
      mockClergyTitleRepo.find.mockResolvedValue([{ id: 'title-1' }]);
      const result = await service.getAll();
      expect(mockClergyTitleRepo.find).toHaveBeenCalledWith({
        order: { createdAt: 'DESC' },
      });
      expect(mockCacheService.set).toHaveBeenCalled();
      expect(result).toEqual([{ id: 'title-1' }]);
    });
  });

  describe('getOne', () => {
    it('throws NotFoundException for an unknown id', async () => {
      mockClergyTitleRepo.findOneBy.mockResolvedValue(null);
      await expect(service.getOne('nope')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('renames when the new name is unused', async () => {
      mockClergyTitleRepo.findOneBy.mockResolvedValue({
        id: 'title-1',
        name: 'Priest',
        description: null,
      });
      mockClergyTitleRepo.existsBy.mockResolvedValue(false);
      mockClergyTitleRepo.save.mockImplementation((t) => Promise.resolve(t));

      const result = await service.update(
        'title-1',
        { name: 'Parish Priest' },
        'actor-1',
      );

      expect(result.name).toBe('Parish Priest');
      expect(mockCacheService.del).toHaveBeenCalledWith('clergy-titles:all');
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'CLERGY_TITLE_UPDATED',
        expect.objectContaining({ targetId: 'title-1' }),
      );
    });

    it('throws when renaming to a name already in use', async () => {
      mockClergyTitleRepo.findOneBy.mockResolvedValue({
        id: 'title-1',
        name: 'Priest',
      });
      mockClergyTitleRepo.existsBy.mockResolvedValue(true);

      await expect(
        service.update('title-1', { name: 'Bishop' }, 'actor-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('delete', () => {
    it('throws NotFoundException for an unknown id', async () => {
      mockClergyTitleRepo.findOneBy.mockResolvedValue(null);
      await expect(service.delete('nope', 'actor-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('blocks deletion when a clergy member is still assigned to it', async () => {
      mockClergyTitleRepo.findOneBy.mockResolvedValue({
        id: 'title-1',
        name: 'Priest',
      });
      mockClergyRepo.exists.mockResolvedValue(true);

      await expect(service.delete('title-1', 'actor-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(mockClergyTitleRepo.delete).not.toHaveBeenCalled();
    });

    it('deletes when unused', async () => {
      mockClergyTitleRepo.findOneBy.mockResolvedValue({
        id: 'title-1',
        name: 'Priest',
      });
      mockClergyRepo.exists.mockResolvedValue(false);

      await service.delete('title-1', 'actor-1');

      expect(mockClergyTitleRepo.delete).toHaveBeenCalledWith('title-1');
      expect(mockCacheService.del).toHaveBeenCalledWith('clergy-titles:all');
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'CLERGY_TITLE_DELETED',
        expect.objectContaining({ targetId: 'title-1' }),
      );
    });
  });
});
