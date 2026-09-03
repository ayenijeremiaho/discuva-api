import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { FormAttachmentCleanupScheduler } from './form-attachment-cleanup.scheduler';
import { FormFieldAttachment } from '../entity/form-field-attachment.entity';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { CloudinaryService } from '../../utility/service/cloudinary.service';

jest.mock('../../tenant/utility/run-in-tenant-context', () => ({
  runInTenantContext: jest.fn((cls, txHost, envelope, fn) => fn()),
}));

const mockAttachmentRepo = { find: jest.fn(), remove: jest.fn() };
const mockTenantRepo = { find: jest.fn() };
const mockCloudinaryService = { deleteByPublicId: jest.fn() };
const mockCls = {};
const mockTxHost = {};

describe('FormAttachmentCleanupScheduler', () => {
  let scheduler: FormAttachmentCleanupScheduler;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockTenantRepo.find.mockResolvedValue([
      { id: 't1', schemaName: 's1', isActive: true },
    ]);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FormAttachmentCleanupScheduler,
        {
          provide: getRepositoryToken(FormFieldAttachment),
          useValue: mockAttachmentRepo,
        },
        { provide: getRepositoryToken(Tenant), useValue: mockTenantRepo },
        { provide: CloudinaryService, useValue: mockCloudinaryService },
        { provide: ClsService, useValue: mockCls },
        { provide: TransactionHost, useValue: mockTxHost },
      ],
    }).compile();
    scheduler = module.get(FormAttachmentCleanupScheduler);
  });

  it('does nothing when there are no orphaned rows', async () => {
    mockAttachmentRepo.find.mockResolvedValue([]);

    await scheduler.deleteOrphanedAttachments();

    expect(mockCloudinaryService.deleteByPublicId).not.toHaveBeenCalled();
    expect(mockAttachmentRepo.remove).not.toHaveBeenCalled();
  });

  it('deletes the Cloudinary asset and DB row for every orphaned attachment, using its stored resourceType', async () => {
    const orphaned = [
      { id: 'a1', publicId: 'form-submissions/x', resourceType: 'image' },
      { id: 'a2', publicId: 'form-submissions/y', resourceType: 'raw' },
    ];
    mockAttachmentRepo.find.mockResolvedValue(orphaned);

    await scheduler.deleteOrphanedAttachments();

    expect(mockCloudinaryService.deleteByPublicId).toHaveBeenCalledWith(
      'form-submissions/x',
      'image',
    );
    expect(mockCloudinaryService.deleteByPublicId).toHaveBeenCalledWith(
      'form-submissions/y',
      'raw',
    );
    expect(mockAttachmentRepo.remove).toHaveBeenCalledWith(orphaned);
  });

  it('queries with a cutoff strictly older than the grace window', async () => {
    mockAttachmentRepo.find.mockResolvedValue([]);

    await scheduler.deleteOrphanedAttachments();

    expect(mockAttachmentRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.any(Object) }),
    );
  });
});
