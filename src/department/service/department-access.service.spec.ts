import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException } from '@nestjs/common';
import { DepartmentAccessService } from './department-access.service';
import { DepartmentLead } from '../entity/department-lead.entity';
import { WorkerProfile } from '../../member/entity/worker-profile.entity';
import { DepartmentCapability } from '../enums/department-capability.enum';

const mockQueryBuilder = {
  select: jest.fn().mockReturnThis(),
  innerJoin: jest.fn().mockReturnThis(),
  leftJoin: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  getRawMany: jest.fn(),
};

const mockWorkerProfileRepo = {
  findOne: jest.fn(),
  createQueryBuilder: jest.fn(() => mockQueryBuilder),
};

const mockLeadRepo = { findOne: jest.fn() };

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
        {
          provide: getRepositoryToken(DepartmentLead),
          useValue: mockLeadRepo,
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

  describe('findMemberIdsWithCapability', () => {
    it('returns the member ids from the raw query result', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue([
        { memberId: 'member-1' },
        { memberId: 'member-2' },
      ]);

      const result = await service.findMemberIdsWithCapability(
        DepartmentCapability.MANAGE_SUNDAY_SCHOOL,
      );

      expect(result).toEqual(['member-1', 'member-2']);
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        expect.stringContaining('ANY(d.capabilities)'),
        { cap: DepartmentCapability.MANAGE_SUNDAY_SCHOOL },
      );
    });

    it('returns an empty array when nobody has the capability', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue([]);

      const result = await service.findMemberIdsWithCapability(
        DepartmentCapability.MANAGE_SUNDAY_SCHOOL,
      );

      expect(result).toEqual([]);
    });
  });

  describe('team lookups', () => {
    it("returns a member's primary and secondary departments", async () => {
      mockWorkerProfileRepo.findOne.mockResolvedValueOnce({
        department: { id: 'd-1' },
        secondaryDepartment: { id: 'd-2' },
      });

      await expect(service.findDepartmentIdsForMember('m-1')).resolves.toEqual([
        'd-1',
        'd-2',
      ]);
    });

    it('returns no departments for a non-worker', async () => {
      mockWorkerProfileRepo.findOne.mockResolvedValueOnce(null);

      await expect(service.findDepartmentIdsForMember('m-1')).resolves.toEqual(
        [],
      );
    });

    it('returns the HOD as a contact', async () => {
      mockLeadRepo.findOne.mockResolvedValueOnce({
        workerProfile: {
          member: {
            id: 'm-hod',
            firstname: 'Hilda',
            lastname: 'O',
            email: 'h@example.com',
          },
        },
      });

      await expect(service.findHeadOfDepartment('d-1')).resolves.toEqual({
        id: 'm-hod',
        firstname: 'Hilda',
        lastname: 'O',
        email: 'h@example.com',
      });
    });
  });
});
