import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException } from '@nestjs/common';
import { DepartmentAccessService } from './department-access.service';
import { WorkerProfile } from '../../member/entity/worker-profile.entity';

const mockWorkerProfileRepo = {
  findOne: jest.fn(),
};

describe('DepartmentAccessService', () => {
  let service: DepartmentAccessService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DepartmentAccessService,
        {
          provide: getRepositoryToken(WorkerProfile),
          useValue: mockWorkerProfileRepo,
        },
      ],
    }).compile();
    service = module.get(DepartmentAccessService);
  });

  describe('hasDepartmentAccessKey', () => {
    it('returns false when the member has no WorkerProfile', async () => {
      mockWorkerProfileRepo.findOne.mockResolvedValue(null);
      await expect(
        service.hasDepartmentAccessKey('member-1', 'EVANGELISM'),
      ).resolves.toBe(false);
    });

    it('returns true when the primary department matches the key', async () => {
      mockWorkerProfileRepo.findOne.mockResolvedValue({
        department: { key: 'EVANGELISM' },
        secondaryDepartment: null,
      });
      await expect(
        service.hasDepartmentAccessKey('member-1', 'EVANGELISM'),
      ).resolves.toBe(true);
    });

    it('returns true when the secondary department matches the key', async () => {
      mockWorkerProfileRepo.findOne.mockResolvedValue({
        department: { key: 'MEDIA' },
        secondaryDepartment: { key: 'EVANGELISM' },
      });
      await expect(
        service.hasDepartmentAccessKey('member-1', 'EVANGELISM'),
      ).resolves.toBe(true);
    });

    it('returns false when neither department matches the key', async () => {
      mockWorkerProfileRepo.findOne.mockResolvedValue({
        department: { key: 'MEDIA' },
        secondaryDepartment: null,
      });
      await expect(
        service.hasDepartmentAccessKey('member-1', 'EVANGELISM'),
      ).resolves.toBe(false);
    });

    it('works with an arbitrary custom key, not just DepartmentKeyEnum presets', async () => {
      mockWorkerProfileRepo.findOne.mockResolvedValue({
        department: { key: 'STAGE_LIGHTING' },
        secondaryDepartment: null,
      });
      await expect(
        service.hasDepartmentAccessKey('member-1', 'STAGE_LIGHTING'),
      ).resolves.toBe(true);
    });
  });

  describe('assertHasDepartmentAccessKey', () => {
    it('resolves when the member has the key', async () => {
      mockWorkerProfileRepo.findOne.mockResolvedValue({
        department: { key: 'PRAYER' },
        secondaryDepartment: null,
      });
      await expect(
        service.assertHasDepartmentAccessKey('member-1', 'PRAYER'),
      ).resolves.toBeUndefined();
    });

    it('throws ForbiddenException with the default message when the member lacks the key', async () => {
      mockWorkerProfileRepo.findOne.mockResolvedValue(null);
      await expect(
        service.assertHasDepartmentAccessKey('member-1', 'PRAYER'),
      ).rejects.toThrow(
        new ForbiddenException(
          "Only workers in the 'PRAYER' department can perform this action",
        ),
      );
    });

    it('throws ForbiddenException with a custom message when provided', async () => {
      mockWorkerProfileRepo.findOne.mockResolvedValue(null);
      await expect(
        service.assertHasDepartmentAccessKey(
          'member-1',
          'PRAYER',
          'Custom denial message',
        ),
      ).rejects.toThrow(new ForbiddenException('Custom denial message'));
    });
  });
});
