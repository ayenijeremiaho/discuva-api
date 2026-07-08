import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { HttpException, NotFoundException } from '@nestjs/common';
import { IncidentReportService } from './incident-report.service';
import { IncidentReport } from '../entity/incident-report.entity';
import { IncidentStatus } from '../enum/incident-status.enum';
import { Admin } from '../../admin/entity/admin.entity';
import { CacheService } from '../../utility/service/cache.service';
import { UtilityService } from '../../utility/service/utility.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { CloudinaryService } from '../../utility/service/cloudinary.service';
import { ConfigService } from '@nestjs/config';

const mockAdmin = { id: 'admin-1', member: { id: 'member-admin-1' } } as any;

const mockReportQb = {
  leftJoinAndSelect: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
};

const mockReportRepo = {
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  findAndCount: jest.fn(),
  createQueryBuilder: jest.fn().mockReturnValue(mockReportQb),
};

const mockAdminRepo = {
  createQueryBuilder: jest.fn(),
};

const mockCacheService = {
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(1),
  incr: jest.fn().mockResolvedValue(1),
};

const mockConfigService = {
  get: jest.fn((key: string, fallback?: unknown) => {
    if (key === 'INCIDENT_DAILY_REPORT_LIMIT') return 2;
    if (key === 'ADMIN_LOGIN_URL') return 'https://admin.example.com';
    return fallback;
  }),
};

const mockUtilityService = {
  sendEmailWithTemplate: jest.fn(),
};

const mockAuditLogService = {
  log: jest.fn(),
};

const mockCloudinaryService = {
  uploadBuffer: jest.fn().mockResolvedValue({
    secureUrl:
      'https://res.cloudinary.com/test/image/upload/v1/incident-images/img.jpg',
    publicId: 'incident-images/img',
    resourceType: 'image',
  }),
};

const mockQb = {
  leftJoinAndSelect: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  getMany: jest.fn().mockResolvedValue([]),
};

describe('IncidentReportService', () => {
  let service: IncidentReportService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCacheService.incr.mockResolvedValue(1);
    mockAdminRepo.createQueryBuilder.mockReturnValue(mockQb);
    mockQb.getMany.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IncidentReportService,
        {
          provide: getRepositoryToken(IncidentReport),
          useValue: mockReportRepo,
        },
        { provide: getRepositoryToken(Admin), useValue: mockAdminRepo },
        { provide: CacheService, useValue: mockCacheService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: UtilityService, useValue: mockUtilityService },
        { provide: AuditLogService, useValue: mockAuditLogService },
        { provide: CloudinaryService, useValue: mockCloudinaryService },
      ],
    }).compile();

    service = module.get<IncidentReportService>(IncidentReportService);
  });

  describe('create', () => {
    it('creates and saves an incident report', async () => {
      const dto = {
        title: 'Broken window',
        description: 'Window in hall B is broken',
      };
      const created = {
        id: 'uuid-1',
        ...dto,
        isAnonymous: false,
        images: null,
        location: null,
        reporter: { id: 'member-1' },
      };
      mockReportRepo.create.mockReturnValue(created);
      mockReportRepo.save.mockResolvedValue(created);

      const result = await service.create(dto, 'member-1');

      expect(mockReportRepo.create).toHaveBeenCalled();
      expect(mockReportRepo.save).toHaveBeenCalledWith(created);
      expect(result).toEqual(created);
    });

    it('uses isAnonymous:false by default', async () => {
      const dto = { title: 'Test', description: 'Test desc' };
      mockReportRepo.create.mockReturnValue({});
      mockReportRepo.save.mockResolvedValue({});

      await service.create(dto, 'member-1');

      expect(mockReportRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ isAnonymous: false }),
      );
    });

    it('uploads image files to cloudinary and stores urls', async () => {
      const dto = { title: 'Broken window', description: 'Cracked glass' };
      const fakeFile = {
        buffer: Buffer.from('img'),
        mimetype: 'image/jpeg',
      } as Express.Multer.File;
      const created = {
        id: 'uuid-1',
        ...dto,
        images: null,
        isAnonymous: false,
        location: null,
        reporter: { id: 'member-1' },
      };
      mockReportRepo.create.mockReturnValue(created);
      mockReportRepo.save.mockResolvedValue({
        ...created,
        images: [
          'https://res.cloudinary.com/test/image/upload/v1/incident-images/img.jpg',
        ],
      });

      await service.create(dto, 'member-1', [fakeFile]);

      expect(mockCloudinaryService.uploadBuffer).toHaveBeenCalledWith(
        fakeFile.buffer,
        'incident-images',
        undefined,
        'image/jpeg',
      );
      expect(mockReportRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          images: [
            'https://res.cloudinary.com/test/image/upload/v1/incident-images/img.jpg',
          ],
        }),
      );
    });

    it('throws 429 when daily limit exceeded', async () => {
      mockCacheService.incr.mockResolvedValue(3);
      const dto = { title: 'Test', description: 'Desc' };

      await expect(service.create(dto, 'member-1')).rejects.toThrow(
        HttpException,
      );
    });

    it('allows exactly up to the daily limit', async () => {
      mockCacheService.incr.mockResolvedValue(2);
      const dto = { title: 'Test', description: 'Desc' };
      mockReportRepo.create.mockReturnValue({});
      mockReportRepo.save.mockResolvedValue({});

      await expect(service.create(dto, 'member-1')).resolves.not.toThrow();
    });
  });

  describe('findMyReports', () => {
    it('returns only reports belonging to the requesting member', async () => {
      const reports = [
        { id: 'uuid-1', reporter: { id: 'member-1' } },
        { id: 'uuid-2', reporter: { id: 'member-1' } },
      ];
      mockReportRepo.findAndCount.mockResolvedValue([reports, 2]);

      const result = await service.findMyReports('member-1', 1, 20);

      expect(result.data).toEqual(reports);
      expect(result.totalCount).toBe(2);
      expect(mockReportRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: { reporter: { id: 'member-1' } } }),
      );
    });
  });

  describe('findMyReport', () => {
    it('returns the report when it belongs to the member', async () => {
      const report = { id: 'uuid-1', title: 'Test' };
      mockReportRepo.findOne.mockResolvedValue(report);

      const result = await service.findMyReport('uuid-1', 'member-1');

      expect(result).toEqual(report);
      expect(mockReportRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'uuid-1', reporter: { id: 'member-1' } },
        }),
      );
    });

    it('throws NotFoundException when report does not belong to the member', async () => {
      mockReportRepo.findOne.mockResolvedValue(null);

      await expect(
        service.findMyReport('uuid-1', 'other-member'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAll', () => {
    beforeEach(() => {
      mockReportRepo.findAndCount.mockResolvedValue([[], 0]);
    });

    it('returns paginated incident reports', async () => {
      const reports = [{ id: 'uuid-1' }, { id: 'uuid-2' }];
      mockReportRepo.findAndCount.mockResolvedValue([reports, 2]);

      const result = await service.findAll(1, 20);

      expect(result.data).toEqual(reports);
      expect(result.totalCount).toBe(2);
    });

    it('applies status filter when provided', async () => {
      await service.findAll(1, 20, { status: IncidentStatus.OPEN });

      expect(mockReportRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: IncidentStatus.OPEN }),
        }),
      );
    });

    it('applies dateFrom filter when provided', async () => {
      await service.findAll(1, 20, { dateFrom: '2026-01-01' });

      const call = mockReportRepo.findAndCount.mock.calls[0][0];
      expect(call.where.createdAt).toBeDefined();
    });

    it('applies dateTo filter when provided', async () => {
      await service.findAll(1, 20, { dateTo: '2026-01-31' });

      const call = mockReportRepo.findAndCount.mock.calls[0][0];
      expect(call.where.createdAt).toBeDefined();
    });

    it('passes no where conditions when no filters provided', async () => {
      await service.findAll(1, 20, {});

      expect(mockReportRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });
  });

  describe('findOne', () => {
    it('returns the report when found', async () => {
      const report = { id: 'uuid-1', title: 'Test' };
      mockReportRepo.findOne.mockResolvedValue(report);

      const result = await service.findOne('uuid-1');

      expect(result).toEqual(report);
    });

    it('throws NotFoundException when not found', async () => {
      mockReportRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateStatus', () => {
    it('updates status and saves', async () => {
      const report = {
        id: 'uuid-1',
        status: IncidentStatus.OPEN,
        adminNotes: null,
        resolvedAt: null,
        reporter: null,
        isAnonymous: false,
      } as any;
      mockReportRepo.findOne.mockResolvedValue(report);
      mockReportRepo.save.mockResolvedValue({
        ...report,
        status: IncidentStatus.IN_PROGRESS,
      });

      await service.updateStatus(
        'uuid-1',
        { status: IncidentStatus.IN_PROGRESS },
        mockAdmin,
      );

      expect(report.status).toBe(IncidentStatus.IN_PROGRESS);
      expect(mockReportRepo.save).toHaveBeenCalled();
    });

    it('sets resolvedAt when status is RESOLVED', async () => {
      const report = {
        id: 'uuid-1',
        status: IncidentStatus.IN_PROGRESS,
        adminNotes: null,
        resolvedAt: null,
        reporter: null,
        isAnonymous: false,
      } as any;
      mockReportRepo.findOne.mockResolvedValue(report);
      mockReportRepo.save.mockResolvedValue(report);

      await service.updateStatus(
        'uuid-1',
        { status: IncidentStatus.RESOLVED },
        mockAdmin,
      );

      expect(report.resolvedAt).toBeInstanceOf(Date);
    });

    it('updates adminNotes when provided', async () => {
      const report = {
        id: 'uuid-1',
        status: IncidentStatus.OPEN,
        adminNotes: null,
        resolvedAt: null,
        reporter: null,
        isAnonymous: false,
      } as any;
      mockReportRepo.findOne.mockResolvedValue(report);
      mockReportRepo.save.mockResolvedValue(report);

      await service.updateStatus(
        'uuid-1',
        {
          status: IncidentStatus.IN_PROGRESS,
          adminNotes: 'Being investigated',
        },
        mockAdmin,
      );

      expect(report.adminNotes).toBe('Being investigated');
    });
  });

  describe('maskReporter', () => {
    it('returns reporter when isAnonymous is false', () => {
      const report = {
        id: 'uuid-1',
        isAnonymous: false,
        reporter: { id: 'member-1', firstname: 'John' },
      } as any;

      const result = service.maskReporter(report);

      expect(result.reporter).toEqual({ id: 'member-1', firstname: 'John' });
    });

    it('strips reporter when isAnonymous is true', () => {
      const report = {
        id: 'uuid-1',
        isAnonymous: true,
        reporter: { id: 'member-1', firstname: 'John' },
      } as any;

      const result = service.maskReporter(report);

      expect(result.reporter).toBeNull();
    });
  });
});
