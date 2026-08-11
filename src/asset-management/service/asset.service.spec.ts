import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { AssetService } from './asset.service';
import { Asset } from '../entity/asset.entity';
import { MaintenanceSchedule } from '../entity/maintenance-schedule.entity';
import { MaintenanceRecord } from '../entity/maintenance-record.entity';
import {
  AssetCondition,
  AssetStatus,
  MaintenanceCompletionStatus,
  MaintenanceFrequencyUnit,
  MaintenanceRecordType,
} from '../enum/asset.enum';
import { UtilityService } from '../../utility/service/utility.service';
import { AuditLogService } from '../../utility/service/audit-log.service';

const mockAdmin = { id: 'admin-1', member: { id: 'member-admin-1' } } as any;

const mockAssetRepo = {
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  findAndCount: jest.fn(),
  count: jest.fn().mockResolvedValue(0),
  createQueryBuilder: jest.fn(),
};

const mockScheduleRepo = {
  create: jest.fn(),
  save: jest.fn(),
};

const mockRecordRepo = {
  create: jest.fn(),
  save: jest.fn(),
  findAndCount: jest.fn(),
};

const mockUtilityService = {
  createPaginationResponse: jest.fn(),
};

const mockAuditLogService = {
  log: jest.fn(),
};

const mockQb = {
  leftJoinAndSelect: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
};

describe('AssetService', () => {
  let service: AssetService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockAssetRepo.count.mockResolvedValue(0);
    mockAssetRepo.createQueryBuilder.mockReturnValue(mockQb);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssetService,
        { provide: getRepositoryToken(Asset), useValue: mockAssetRepo },
        {
          provide: getRepositoryToken(MaintenanceSchedule),
          useValue: mockScheduleRepo,
        },
        {
          provide: getRepositoryToken(MaintenanceRecord),
          useValue: mockRecordRepo,
        },
        { provide: UtilityService, useValue: mockUtilityService },
        { provide: AuditLogService, useValue: mockAuditLogService },
      ],
    }).compile();

    service = module.get<AssetService>(AssetService);
  });

  describe('create', () => {
    it('auto-generates tag number when not provided', async () => {
      mockAssetRepo.count.mockResolvedValue(4);
      mockAssetRepo.findOne.mockResolvedValue(null);
      const created = {
        id: 'uuid-1',
        tagNumber: `AST-${new Date().getFullYear()}-0005`,
      };
      mockAssetRepo.create.mockReturnValue(created);
      mockAssetRepo.save.mockResolvedValue(created);

      const result = await service.create(
        { name: 'Generator', category: 'Equipment' },
        mockAdmin,
      );

      expect(result.tagNumber).toMatch(/^AST-\d{4}-0005$/);
    });

    it('uses provided tag number', async () => {
      mockAssetRepo.findOne.mockResolvedValue(null);
      const created = { id: 'uuid-1', tagNumber: 'AST-CUSTOM-001' };
      mockAssetRepo.create.mockReturnValue(created);
      mockAssetRepo.save.mockResolvedValue(created);

      await service.create(
        {
          tagNumber: 'AST-CUSTOM-001',
          name: 'Generator',
          category: 'Equipment',
        },
        mockAdmin,
      );

      expect(mockAssetRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ tagNumber: 'AST-CUSTOM-001' }),
      );
    });

    it('throws ConflictException when tag number already exists', async () => {
      mockAssetRepo.findOne.mockResolvedValue({ id: 'existing' });

      await expect(
        service.create(
          {
            tagNumber: 'AST-2026-0001',
            name: 'Generator',
            category: 'Equipment',
          },
          mockAdmin,
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('findOne', () => {
    it('returns asset when found', async () => {
      const asset = { id: 'uuid-1', name: 'Generator' };
      mockAssetRepo.findOne.mockResolvedValue(asset);

      const result = await service.findOne('uuid-1');

      expect(result).toEqual(asset);
    });

    it('throws NotFoundException when not found', async () => {
      mockAssetRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('updates only the provided fields', async () => {
      const asset = {
        id: 'uuid-1',
        name: 'Old Name',
        category: 'Equipment',
        status: AssetStatus.ACTIVE,
        maintenanceSchedule: null,
        maintenanceRecords: [],
      };
      mockAssetRepo.findOne.mockResolvedValue(asset);
      mockAssetRepo.save.mockResolvedValue({ ...asset, name: 'New Name' });

      await service.update('uuid-1', { name: 'New Name' }, mockAdmin);

      expect(asset.name).toBe('New Name');
      expect(mockAssetRepo.save).toHaveBeenCalled();
    });
  });

  describe('setMaintenanceSchedule', () => {
    it('creates schedule and enables maintenance when no prior schedule exists', async () => {
      const asset = {
        id: 'uuid-1',
        maintenanceSchedule: null,
        maintenanceRecords: [],
      };
      mockAssetRepo.findOne
        .mockResolvedValueOnce(asset)
        .mockResolvedValueOnce({ ...asset, maintenanceEnabled: true });
      const schedule = {};
      mockScheduleRepo.create.mockReturnValue(schedule);
      mockScheduleRepo.save.mockResolvedValue(schedule);
      mockAssetRepo.save.mockResolvedValue({
        ...asset,
        maintenanceEnabled: true,
      });

      await service.setMaintenanceSchedule(
        'uuid-1',
        {
          frequencyUnit: MaintenanceFrequencyUnit.MONTHS,
          frequencyValue: 3,
          nextDueAt: '2026-09-01',
        },
        mockAdmin,
      );

      expect(mockScheduleRepo.create).toHaveBeenCalledWith({
        asset: { id: 'uuid-1' },
      });
      expect(schedule).toMatchObject({
        frequencyUnit: MaintenanceFrequencyUnit.MONTHS,
        frequencyValue: 3,
        nextDueAt: '2026-09-01',
        notifiedThresholds: [],
        lastOverdueNotifiedAt: null,
      });
    });

    it('resets notification thresholds when schedule is updated', async () => {
      const existingSchedule = {
        id: 'sched-1',
        frequencyUnit: MaintenanceFrequencyUnit.MONTHS,
        frequencyValue: 1,
        nextDueAt: '2026-07-01',
        notifiedThresholds: [7, 3],
        lastOverdueNotifiedAt: null,
      };
      const asset = {
        id: 'uuid-1',
        maintenanceSchedule: existingSchedule,
        maintenanceRecords: [],
      };
      mockAssetRepo.findOne.mockResolvedValue(asset);
      mockScheduleRepo.save.mockResolvedValue(existingSchedule);
      mockAssetRepo.save.mockResolvedValue(asset);

      await service.setMaintenanceSchedule(
        'uuid-1',
        {
          frequencyUnit: MaintenanceFrequencyUnit.MONTHS,
          frequencyValue: 3,
          nextDueAt: '2026-09-01',
        },
        mockAdmin,
      );

      expect(existingSchedule.notifiedThresholds).toEqual([]);
    });
  });

  describe('logMaintenanceRecord', () => {
    const admin = { id: 'admin-1' } as any;

    it('sets asset status to ACTIVE when completionStatus is COMPLETED', async () => {
      const asset = {
        id: 'uuid-1',
        status: AssetStatus.UNDER_MAINTENANCE,
        maintenanceSchedule: null,
        maintenanceRecords: [],
      };
      mockAssetRepo.findOne.mockResolvedValue(asset);
      const record = {};
      mockRecordRepo.create.mockReturnValue(record);
      mockRecordRepo.save.mockResolvedValue(record);
      mockAssetRepo.save.mockResolvedValue(asset);

      await service.logMaintenanceRecord(
        'uuid-1',
        {
          type: MaintenanceRecordType.SCHEDULED,
          performedAt: '2026-06-18',
          performedBy: 'Tech Team',
          notes: 'All done',
          conditionAfter: AssetCondition.GOOD,
          completionStatus: MaintenanceCompletionStatus.COMPLETED,
        },
        admin,
      );

      expect(asset.status).toBe(AssetStatus.ACTIVE);
    });

    it('sets asset status to UNDER_MAINTENANCE when completionStatus is IN_PROGRESS', async () => {
      const asset = {
        id: 'uuid-1',
        status: AssetStatus.ACTIVE,
        maintenanceSchedule: null,
        maintenanceRecords: [],
      };
      mockAssetRepo.findOne.mockResolvedValue(asset);
      const record = {};
      mockRecordRepo.create.mockReturnValue(record);
      mockRecordRepo.save.mockResolvedValue(record);
      mockAssetRepo.save.mockResolvedValue(asset);

      await service.logMaintenanceRecord(
        'uuid-1',
        {
          type: MaintenanceRecordType.SCHEDULED,
          performedAt: '2026-06-18',
          performedBy: 'Tech Team',
          notes: 'In progress',
          conditionAfter: AssetCondition.FAIR,
          completionStatus: MaintenanceCompletionStatus.IN_PROGRESS,
        },
        admin,
      );

      expect(asset.status).toBe(AssetStatus.UNDER_MAINTENANCE);
    });

    it('resets schedule and recalculates nextDueAt when COMPLETED with a schedule', async () => {
      const schedule = {
        id: 'sched-1',
        frequencyUnit: MaintenanceFrequencyUnit.MONTHS,
        frequencyValue: 3,
        nextDueAt: '2026-06-01',
        notifiedThresholds: [7],
        lastMaintainedAt: null,
        lastOverdueNotifiedAt: null,
      };
      const asset = {
        id: 'uuid-1',
        status: AssetStatus.UNDER_MAINTENANCE,
        maintenanceSchedule: schedule,
        maintenanceRecords: [],
      };
      mockAssetRepo.findOne.mockResolvedValue(asset);
      const record = {};
      mockRecordRepo.create.mockReturnValue(record);
      mockRecordRepo.save.mockResolvedValue(record);
      mockAssetRepo.save.mockResolvedValue(asset);
      mockScheduleRepo.save.mockResolvedValue(schedule);

      await service.logMaintenanceRecord(
        'uuid-1',
        {
          type: MaintenanceRecordType.SCHEDULED,
          performedAt: '2026-06-18',
          performedBy: 'Tech Team',
          notes: 'Done',
          conditionAfter: AssetCondition.GOOD,
          completionStatus: MaintenanceCompletionStatus.COMPLETED,
        },
        admin,
      );

      expect(schedule.lastMaintainedAt).toBe('2026-06-18');
      expect(schedule.nextDueAt).toBe('2026-09-18');
      expect(schedule.notifiedThresholds).toEqual([]);
    });
  });
});
