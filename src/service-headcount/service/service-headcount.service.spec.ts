import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ServiceHeadcountService } from './service-headcount.service';
import { ServiceHeadcount } from '../entity/service-headcount.entity';
import { ServiceSlot } from '../../event/entity/service-slot.entity';
import { CacheService } from '../../utility/service/cache.service';

const mockCacheService = {
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(1),
  getOrSet: jest
    .fn()
    .mockImplementation((_key: string, fn: () => Promise<unknown>) => fn()),
  flushNamespace: jest.fn().mockResolvedValue(undefined),
};

const mockHeadcountRepo = {
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  find: jest.fn(),
  createQueryBuilder: jest.fn(),
};

const mockServiceSlotRepo = {
  findOne: jest.fn(),
  find: jest.fn(),
};

const mockAdmin = {
  id: 'admin-1',
  member: { firstname: 'Ada', lastname: 'Admin' },
};

const mockSlot = {
  id: 'slot-1',
  name: 'First Service',
  startTime: new Date('2026-06-15T08:00:00Z'),
};

const mockRecord = {
  id: 'hc-1',
  serviceSlot: mockSlot,
  maleAdults: 100,
  femaleAdults: 120,
  teenagers: 30,
  children: 20,
  mobileChurch: 15,
  customGroups: {},
  notes: null,
  recordedBy: mockAdmin,
};

const qbMock = {
  innerJoinAndSelect: jest.fn().mockReturnThis(),
  leftJoinAndSelect: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  getManyAndCount: jest.fn().mockResolvedValue([[mockRecord], 1]),
  getMany: jest.fn().mockResolvedValue([mockRecord]),
};

describe('ServiceHeadcountService', () => {
  let service: ServiceHeadcountService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockHeadcountRepo.createQueryBuilder.mockReturnValue(qbMock);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServiceHeadcountService,
        { provide: CacheService, useValue: mockCacheService },
        {
          provide: getRepositoryToken(ServiceHeadcount),
          useValue: mockHeadcountRepo,
        },
        {
          provide: getRepositoryToken(ServiceSlot),
          useValue: mockServiceSlotRepo,
        },
      ],
    }).compile();

    service = module.get<ServiceHeadcountService>(ServiceHeadcountService);
  });

  // ── create ────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('creates a new headcount record when the slot has none yet', async () => {
      mockServiceSlotRepo.findOne.mockResolvedValue(mockSlot);
      mockHeadcountRepo.findOne.mockResolvedValue(null);
      mockHeadcountRepo.create.mockReturnValue({ ...mockRecord });
      mockHeadcountRepo.save.mockImplementation((r) => Promise.resolve(r));

      const dto = {
        serviceSlotId: 'slot-1',
        maleAdults: 100,
        femaleAdults: 120,
        teenagers: 30,
        children: 20,
        mobileChurch: 15,
      };
      const result = await service.create(dto, mockAdmin as any);

      expect(mockServiceSlotRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'slot-1' },
      });
      expect(mockHeadcountRepo.create).toHaveBeenCalledWith({
        serviceSlot: mockSlot,
      });
      expect(mockHeadcountRepo.save).toHaveBeenCalled();
      expect(result.total).toBe(285);
    });

    it('edits the existing record in place when the slot already has one, instead of creating a sibling', async () => {
      const mutable = { ...mockRecord };
      mockServiceSlotRepo.findOne.mockResolvedValue(mockSlot);
      mockHeadcountRepo.findOne.mockResolvedValue(mutable);
      mockHeadcountRepo.save.mockImplementation((r) => Promise.resolve(r));

      const result = await service.create(
        { serviceSlotId: 'slot-1', maleAdults: 200 },
        mockAdmin as any,
      );

      expect(mockHeadcountRepo.create).not.toHaveBeenCalled();
      expect(result.maleAdults).toBe(200);
      expect(result.femaleAdults).toBe(0);
    });

    it('throws NotFoundException when service slot does not exist', async () => {
      mockServiceSlotRepo.findOne.mockResolvedValue(null);
      await expect(
        service.create({ serviceSlotId: 'bad-id' }, mockAdmin as any),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── update ────────────────────────────────────────────────────────────────

  // ── findAll ───────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('returns paginated results with computed total', async () => {
      const result = await service.findAll(1, 20);
      expect(result.totalCount).toBe(1);
      expect(result.data[0].total).toBe(285);
    });

    it('throws BadRequestException when page is less than 1', async () => {
      await expect(service.findAll(0)).rejects.toThrow(BadRequestException);
    });
  });

  // ── findOne ───────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('returns record with computed total', async () => {
      mockHeadcountRepo.findOne.mockResolvedValue(mockRecord);
      const result = await service.findOne('hc-1');
      expect(result.total).toBe(285);
    });

    it('throws NotFoundException when record does not exist', async () => {
      mockHeadcountRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne('bad-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── getEventSummary ──────────────────────────────────────────────────────

  describe('getEventSummary', () => {
    const secondSlot = {
      id: 'slot-2',
      name: 'Second Service',
      startTime: new Date('2026-06-15T10:00:00Z'),
    };

    it('returns every sub-service with its headcount and the aggregated total', async () => {
      mockServiceSlotRepo.find.mockResolvedValue([
        { ...mockSlot, event: { name: 'Sunday Service' } },
        { ...secondSlot, event: { name: 'Sunday Service' } },
      ]);
      mockHeadcountRepo.find.mockResolvedValue([mockRecord]);

      const result = await service.getEventSummary('event-1');

      expect(result.eventName).toBe('Sunday Service');
      expect(result.slotCount).toBe(2);
      expect(result.recordedCount).toBe(1);
      expect(result.serviceSlots).toHaveLength(2);
      expect(result.serviceSlots[0].headcount?.total).toBe(285);
      expect(result.serviceSlots[1].headcount).toBeNull();
      expect(result.total.total).toBe(285);
    });

    it('throws NotFoundException when the event has no service slots', async () => {
      mockServiceSlotRepo.find.mockResolvedValue([]);
      await expect(service.getEventSummary('bad-event')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── getTrends ─────────────────────────────────────────────────────────────

  describe('getTrends', () => {
    it('groups records by week and returns trend points', async () => {
      const result = await service.getTrends('weekly');
      expect(result.period).toBe('weekly');
      expect(result.data.length).toBe(1);
      expect(result.data[0].total).toBe(285);
      expect(result.data[0].serviceSlotName).toBe('First Service');
    });

    it('groups records by month', async () => {
      const result = await service.getTrends('monthly');
      expect(result.data[0].periodLabel).toMatch(/^\d{4}-\d{2}$/);
    });

    it('groups records by quarter', async () => {
      const result = await service.getTrends('quarterly');
      expect(result.data[0].periodLabel).toMatch(/^\d{4}-Q\d$/);
    });

    it('defaults to a bounded ~365-day lookback instead of the full history when "from" is omitted', async () => {
      const result = await service.getTrends('weekly');

      const call = qbMock.andWhere.mock.calls.find(
        (c: unknown[]) => c[0] === 'slot.startTime >= :from',
      );
      expect(call).toBeDefined();
      const usedFrom = (call![1] as { from: Date }).from;
      const daysAgo = (Date.now() - usedFrom.getTime()) / (1000 * 60 * 60 * 24);
      expect(daysAgo).toBeGreaterThan(364);
      expect(daysAgo).toBeLessThan(366);
      expect(result.from).toBe(usedFrom.toISOString().slice(0, 10));
    });

    it('uses the caller-supplied "from" as-is instead of the default', async () => {
      await service.getTrends('weekly', '2020-01-01');

      expect(qbMock.andWhere).toHaveBeenCalledWith('slot.startTime >= :from', {
        from: new Date('2020-01-01'),
      });
    });
  });
});
