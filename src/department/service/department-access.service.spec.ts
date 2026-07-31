import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException } from '@nestjs/common';
import { DepartmentAccessService } from './department-access.service';
import { WorkerProfile } from '../../member/entity/worker-profile.entity';
import { DepartmentCapability } from '../enums/department-capability.enum';

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

  describe('hasCapability', () => {
    it('returns false when the member has no WorkerProfile', async () => {
      mockWorkerProfileRepo.findOne.mockResolvedValue(null);
      await expect(
        service.hasCapability(
          'member-1',
          DepartmentCapability.MANAGE_EVANGELISM_CONVERTS,
        ),
      ).resolves.toBe(false);
    });

    it('returns true when the primary department has the capability', async () => {
      mockWorkerProfileRepo.findOne.mockResolvedValue({
        department: {
          capabilities: [DepartmentCapability.MANAGE_EVANGELISM_CONVERTS],
        },
        secondaryDepartment: null,
      });
      await expect(
        service.hasCapability(
          'member-1',
          DepartmentCapability.MANAGE_EVANGELISM_CONVERTS,
        ),
      ).resolves.toBe(true);
    });

    it('returns true when the secondary department has the capability', async () => {
      mockWorkerProfileRepo.findOne.mockResolvedValue({
        department: { capabilities: [DepartmentCapability.MANAGE_FOLLOW_UP] },
        secondaryDepartment: {
          capabilities: [DepartmentCapability.MANAGE_EVANGELISM_CONVERTS],
        },
      });
      await expect(
        service.hasCapability(
          'member-1',
          DepartmentCapability.MANAGE_EVANGELISM_CONVERTS,
        ),
      ).resolves.toBe(true);
    });

    it('returns false when neither department has the capability', async () => {
      mockWorkerProfileRepo.findOne.mockResolvedValue({
        department: { capabilities: [DepartmentCapability.MANAGE_FOLLOW_UP] },
        secondaryDepartment: null,
      });
      await expect(
        service.hasCapability(
          'member-1',
          DepartmentCapability.MANAGE_EVANGELISM_CONVERTS,
        ),
      ).resolves.toBe(false);
    });

    it('returns true when a department holds multiple capabilities including the one checked', async () => {
      mockWorkerProfileRepo.findOne.mockResolvedValue({
        department: {
          capabilities: [
            DepartmentCapability.MANAGE_CHILDREN_CHURCH,
            DepartmentCapability.MANAGE_SUNDAY_SCHOOL,
          ],
        },
        secondaryDepartment: null,
      });
      await expect(
        service.hasCapability(
          'member-1',
          DepartmentCapability.MANAGE_SUNDAY_SCHOOL,
        ),
      ).resolves.toBe(true);
    });
  });

  describe('assertHasCapability', () => {
    it('resolves when the member has the capability', async () => {
      mockWorkerProfileRepo.findOne.mockResolvedValue({
        department: {
          capabilities: [DepartmentCapability.MANAGE_PRAYER_REQUESTS],
        },
        secondaryDepartment: null,
      });
      await expect(
        service.assertHasCapability(
          'member-1',
          DepartmentCapability.MANAGE_PRAYER_REQUESTS,
        ),
      ).resolves.toBeUndefined();
    });

    it('throws ForbiddenException with the default message when the member lacks the capability', async () => {
      mockWorkerProfileRepo.findOne.mockResolvedValue(null);
      await expect(
        service.assertHasCapability(
          'member-1',
          DepartmentCapability.MANAGE_PRAYER_REQUESTS,
        ),
      ).rejects.toThrow(
        new ForbiddenException(
          "Only workers in a department with the 'MANAGE_PRAYER_REQUESTS' capability can perform this action",
        ),
      );
    });

    it('throws ForbiddenException with a custom message when provided', async () => {
      mockWorkerProfileRepo.findOne.mockResolvedValue(null);
      await expect(
        service.assertHasCapability(
          'member-1',
          DepartmentCapability.MANAGE_PRAYER_REQUESTS,
          'Custom denial message',
        ),
      ).rejects.toThrow(new ForbiddenException('Custom denial message'));
    });
  });
});
