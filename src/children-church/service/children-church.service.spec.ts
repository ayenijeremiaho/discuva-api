import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ChildrenChurchService } from './children-church.service';
import { ChildAgeGroup } from '../entity/child-age-group.entity';
import { ChildClassGroup } from '../entity/child-class-group.entity';
import { ChildProfile } from '../entity/child-profile.entity';
import { ChildGuardian } from '../entity/child-guardian.entity';
import { ChildCheckIn } from '../entity/child-check-in.entity';
import { ChildCheckInStatusEnum } from '../enums/child-checkin-status.enum';
import { GuardianRelationshipEnum } from '../enums/guardian-relationship.enum';
import { Member } from '../../member/entity/member.entity';
import { MemberRoleEnum } from '../../member/enums/member-role.enum';
import { DepartmentKeyEnum } from '../../department/enums/department-key.enum';
import { DepartmentAccessService } from '../../department/service/department-access.service';
import { UtilityService } from '../../utility/service/utility.service';
import { SessionSurface } from '../../auth/enum/session-surface.enum';
import { ConfigService } from '@nestjs/config';

const mockAgeGroupRepo = {
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  find: jest.fn(),
  remove: jest.fn(),
};

const mockClassGroupRepo = {
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  find: jest.fn(),
  remove: jest.fn(),
};

const mockChildProfileRepo = {
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  find: jest.fn(),
  count: jest.fn(),
  createQueryBuilder: jest.fn(),
};

const mockGuardianRepo = {
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  find: jest.fn(),
  remove: jest.fn(),
};

const mockCheckInRepo = {
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  find: jest.fn(),
  existsBy: jest.fn(),
};

const mockMemberRepo = {};

const mockDepartmentAccessService = {
  hasDepartmentAccessKey: jest.fn(),
  assertHasDepartmentAccessKey: jest.fn(),
};

const mockUtilityService = {
  sendEmailWithTemplate: jest.fn(),
};

// ─── User fixtures ─────────────────────────────────────────────────────────

const adminUser = {
  id: 'admin-1',
  role: MemberRoleEnum.WORKER,
  requiresPasswordChange: false,
  surface: SessionSurface.MEMBER,
};
const ccWorkerUser = {
  id: 'cc-worker-1',
  role: MemberRoleEnum.WORKER,
  requiresPasswordChange: false,
  surface: SessionSurface.MEMBER,
};
const otherWorkerUser = {
  id: 'other-worker-1',
  role: MemberRoleEnum.WORKER,
  requiresPasswordChange: false,
  surface: SessionSurface.MEMBER,
};

// ─── Data fixtures ─────────────────────────────────────────────────────────

const mockAgeGroup = {
  id: 'ag-1',
  name: 'Nursery',
  minAgeMonths: 0,
  maxAgeMonths: 23,
};
const mockClassGroup = { id: 'cg-1', name: 'Room A', ageGroup: mockAgeGroup };
const mockChild = {
  id: 'child-1',
  firstname: 'Alice',
  lastname: 'Smith',
  dateOfBirth: '2024-01-15',
  ageGroup: mockAgeGroup,
  classGroup: mockClassGroup,
};

const makeQb = () => ({
  leftJoinAndSelect: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  addOrderBy: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  getManyAndCount: jest.fn(),
});

describe('ChildrenChurchService', () => {
  let service: ChildrenChurchService;

  beforeEach(async () => {
    jest.resetAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChildrenChurchService,
        {
          provide: getRepositoryToken(ChildAgeGroup),
          useValue: mockAgeGroupRepo,
        },
        {
          provide: getRepositoryToken(ChildClassGroup),
          useValue: mockClassGroupRepo,
        },
        {
          provide: getRepositoryToken(ChildProfile),
          useValue: mockChildProfileRepo,
        },
        {
          provide: getRepositoryToken(ChildGuardian),
          useValue: mockGuardianRepo,
        },
        {
          provide: getRepositoryToken(ChildCheckIn),
          useValue: mockCheckInRepo,
        },
        { provide: getRepositoryToken(Member), useValue: mockMemberRepo },
        {
          provide: DepartmentAccessService,
          useValue: mockDepartmentAccessService,
        },
        { provide: UtilityService, useValue: mockUtilityService },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('Test App') },
        },
      ],
    }).compile();

    service = module.get<ChildrenChurchService>(ChildrenChurchService);
    // Default: authorize as CC dept worker so functional tests focus on business logic
    mockDepartmentAccessService.assertHasDepartmentAccessKey.mockResolvedValue(
      undefined,
    );
  });

  // ─── Authorization ────────────────────────────────────────────────────────

  describe('requireChildrenChurchAuth (via registerChild)', () => {
    beforeEach(() => {
      mockAgeGroupRepo.findOne.mockResolvedValue(mockAgeGroup);
      mockClassGroupRepo.find.mockResolvedValue([mockClassGroup]);
      mockChildProfileRepo.count.mockResolvedValue(0);
      mockChildProfileRepo.create.mockReturnValue(mockChild);
      mockChildProfileRepo.save.mockResolvedValue(mockChild);
    });

    it('admin worker in CC dept is authorized', async () => {
      mockDepartmentAccessService.assertHasDepartmentAccessKey.mockResolvedValue(
        undefined,
      );
      await service.registerChild(adminUser, {
        firstname: 'Alice',
        lastname: 'Smith',
        dateOfBirth: '2024-01-15',
      });
      expect(mockChildProfileRepo.save).toHaveBeenCalled();
    });

    it('CC primary dept worker is allowed', async () => {
      mockDepartmentAccessService.assertHasDepartmentAccessKey.mockResolvedValue(
        undefined,
      );
      await service.registerChild(ccWorkerUser, {
        firstname: 'Alice',
        lastname: 'Smith',
        dateOfBirth: '2024-01-15',
      });
      expect(mockChildProfileRepo.save).toHaveBeenCalled();
    });

    it('CC secondary dept worker is allowed', async () => {
      mockDepartmentAccessService.assertHasDepartmentAccessKey.mockResolvedValue(
        undefined,
      );
      await service.registerChild(ccWorkerUser, {
        firstname: 'Alice',
        lastname: 'Smith',
        dateOfBirth: '2024-01-15',
      });
      expect(mockChildProfileRepo.save).toHaveBeenCalled();
    });

    it('worker from a different department is denied', async () => {
      mockDepartmentAccessService.assertHasDepartmentAccessKey.mockRejectedValue(
        new ForbiddenException(
          'Only Children Church department workers are authorized to perform this action.',
        ),
      );
      await expect(
        service.registerChild(otherWorkerUser, {
          firstname: 'Alice',
          lastname: 'Smith',
          dateOfBirth: '2024-01-15',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('worker with no profile is denied', async () => {
      mockDepartmentAccessService.assertHasDepartmentAccessKey.mockRejectedValue(
        new ForbiddenException(
          'Only Children Church department workers are authorized to perform this action.',
        ),
      );
      await expect(
        service.registerChild(otherWorkerUser, {
          firstname: 'Alice',
          lastname: 'Smith',
          dateOfBirth: '2024-01-15',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('checks the CHILDREN_CHURCH key via DepartmentAccessService', async () => {
      mockDepartmentAccessService.assertHasDepartmentAccessKey.mockResolvedValue(
        undefined,
      );
      await service.registerChild(ccWorkerUser, {
        firstname: 'Alice',
        lastname: 'Smith',
        dateOfBirth: '2024-01-15',
      });
      expect(
        mockDepartmentAccessService.assertHasDepartmentAccessKey,
      ).toHaveBeenCalledWith(
        ccWorkerUser.id,
        DepartmentKeyEnum.CHILDREN_CHURCH,
        expect.any(String),
      );
    });
  });

  // ─── Age Groups (no auth — ADMIN-only at controller) ─────────────────────

  describe('createAgeGroup', () => {
    it('should create and save age group', async () => {
      const dto = { name: 'Nursery', minAgeMonths: 0, maxAgeMonths: 23 };
      mockAgeGroupRepo.create.mockReturnValue(dto);
      mockAgeGroupRepo.save.mockResolvedValue({ id: 'ag-1', ...dto });

      const result = await service.createAgeGroup(dto);

      expect(mockAgeGroupRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Nursery',
          minAgeMonths: 0,
          maxAgeMonths: 23,
        }),
      );
      expect(result.id).toBe('ag-1');
    });

    it('should throw BadRequestException when min >= max', async () => {
      await expect(
        service.createAgeGroup({
          name: 'Bad',
          minAgeMonths: 24,
          maxAgeMonths: 12,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateAgeGroup', () => {
    it('should throw NotFoundException when age group not found', async () => {
      mockAgeGroupRepo.findOne.mockResolvedValue(null);
      await expect(
        service.updateAgeGroup('bad-id', { name: 'New' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should update and save age group', async () => {
      const entity = {
        id: 'ag-1',
        name: 'Old',
        minAgeMonths: 0,
        maxAgeMonths: 23,
      };
      mockAgeGroupRepo.findOne.mockResolvedValue(entity);
      mockAgeGroupRepo.save.mockImplementation((e) => Promise.resolve(e));

      const result = await service.updateAgeGroup('ag-1', { name: 'Updated' });

      expect(result.name).toBe('Updated');
    });

    it('should throw when updated bounds are invalid', async () => {
      const entity = {
        id: 'ag-1',
        name: 'Old',
        minAgeMonths: 0,
        maxAgeMonths: 23,
      };
      mockAgeGroupRepo.findOne.mockResolvedValue(entity);
      await expect(
        service.updateAgeGroup('ag-1', { minAgeMonths: 30, maxAgeMonths: 5 }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('deleteAgeGroup', () => {
    it('should throw NotFoundException when not found', async () => {
      mockAgeGroupRepo.findOne.mockResolvedValue(null);
      await expect(service.deleteAgeGroup('bad-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should remove the age group', async () => {
      mockAgeGroupRepo.findOne.mockResolvedValue(mockAgeGroup);
      mockAgeGroupRepo.remove.mockResolvedValue(undefined);

      await service.deleteAgeGroup('ag-1');

      expect(mockAgeGroupRepo.remove).toHaveBeenCalledWith(mockAgeGroup);
    });
  });

  describe('createClassGroup', () => {
    it('should throw NotFoundException when age group not found', async () => {
      mockAgeGroupRepo.findOne.mockResolvedValue(null);
      await expect(
        service.createClassGroup({ ageGroupId: 'bad', name: 'Room A' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should create class group under age group', async () => {
      mockAgeGroupRepo.findOne.mockResolvedValue(mockAgeGroup);
      mockClassGroupRepo.create.mockReturnValue(mockClassGroup);
      mockClassGroupRepo.save.mockResolvedValue(mockClassGroup);

      const result = await service.createClassGroup({
        ageGroupId: 'ag-1',
        name: 'Room A',
      });

      expect(result).toEqual(mockClassGroup);
    });
  });

  // ─── registerChild ────────────────────────────────────────────────────────

  describe('registerChild', () => {
    beforeEach(() => {
      mockAgeGroupRepo.findOne.mockResolvedValue(mockAgeGroup);
      mockClassGroupRepo.find.mockResolvedValue([mockClassGroup]);
      mockChildProfileRepo.count.mockResolvedValue(0);
    });

    it('should register a child and auto-assign age group', async () => {
      const dto = {
        firstname: 'Alice',
        lastname: 'Smith',
        dateOfBirth: '2024-01-15',
      };
      mockChildProfileRepo.create.mockReturnValue(mockChild);
      mockChildProfileRepo.save.mockResolvedValue(mockChild);

      const result = await service.registerChild(adminUser, dto);

      expect(mockChildProfileRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ firstname: 'Alice', lastname: 'Smith' }),
      );
      expect(result).toEqual(mockChild);
    });

    it('should assign null ageGroup when no matching age group', async () => {
      mockAgeGroupRepo.findOne.mockResolvedValue(null);
      const childNoGroup = { ...mockChild, ageGroup: null, classGroup: null };
      mockChildProfileRepo.create.mockReturnValue(childNoGroup);
      mockChildProfileRepo.save.mockResolvedValue(childNoGroup);

      const result = await service.registerChild(adminUser, {
        firstname: 'Bob',
        lastname: 'Jones',
        dateOfBirth: '1980-01-01',
      });

      expect(mockChildProfileRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ ageGroup: null, classGroup: null }),
      );
      expect(result.ageGroup).toBeNull();
    });
  });

  // ─── getChild ─────────────────────────────────────────────────────────────

  describe('getChild', () => {
    it('should throw NotFoundException when child not found', async () => {
      mockChildProfileRepo.findOne.mockResolvedValue(null);
      await expect(service.getChild(adminUser, 'bad-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should return the child', async () => {
      mockChildProfileRepo.findOne.mockResolvedValue(mockChild);
      const result = await service.getChild(adminUser, 'child-1');
      expect(result).toEqual(mockChild);
    });
  });

  // ─── addGuardian ──────────────────────────────────────────────────────────

  describe('addGuardian', () => {
    it('should throw NotFoundException when child not found', async () => {
      mockChildProfileRepo.findOne.mockResolvedValue(null);
      await expect(
        service.addGuardian(adminUser, 'bad-id', {
          fullName: 'Jane',
          relationship: GuardianRelationshipEnum.MOTHER,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should create and return guardian with email', async () => {
      mockChildProfileRepo.findOne.mockResolvedValue(mockChild);
      const guardian = {
        id: 'g-1',
        fullName: 'Jane',
        email: 'jane@example.com',
        relationship: GuardianRelationshipEnum.MOTHER,
      };
      mockGuardianRepo.create.mockReturnValue(guardian);
      mockGuardianRepo.save.mockResolvedValue(guardian);

      const result = await service.addGuardian(adminUser, 'child-1', {
        fullName: 'Jane',
        email: 'jane@example.com',
        relationship: GuardianRelationshipEnum.MOTHER,
      });

      expect(mockGuardianRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'jane@example.com' }),
      );
      expect(result.email).toBe('jane@example.com');
    });
  });

  // ─── removeGuardian ───────────────────────────────────────────────────────

  describe('removeGuardian', () => {
    it('should throw NotFoundException when guardian not found', async () => {
      mockGuardianRepo.findOne.mockResolvedValue(null);
      await expect(service.removeGuardian(adminUser, 'bad-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should remove guardian', async () => {
      const guardian = { id: 'g-1' };
      mockGuardianRepo.findOne.mockResolvedValue(guardian);
      mockGuardianRepo.remove.mockResolvedValue(undefined);

      await service.removeGuardian(adminUser, 'g-1');

      expect(mockGuardianRepo.remove).toHaveBeenCalledWith(guardian);
    });
  });

  // ─── checkIn ─────────────────────────────────────────────────────────────

  describe('checkIn', () => {
    it('should throw NotFoundException when child not found', async () => {
      mockChildProfileRepo.findOne.mockResolvedValue(null);
      await expect(
        service.checkIn(adminUser, { childId: 'bad' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when child already checked in', async () => {
      mockChildProfileRepo.findOne.mockResolvedValue(mockChild);
      mockCheckInRepo.findOne.mockResolvedValue({
        id: 'ci-1',
        status: ChildCheckInStatusEnum.CHECKED_IN,
      });
      await expect(
        service.checkIn(adminUser, { childId: 'child-1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should create check-in with generated pickup code', async () => {
      mockChildProfileRepo.findOne.mockResolvedValue(mockChild);
      mockCheckInRepo.findOne.mockResolvedValue(null);
      mockCheckInRepo.existsBy.mockResolvedValue(false);
      const checkIn = {
        id: 'ci-1',
        pickupCode: 'ABC123',
        status: ChildCheckInStatusEnum.CHECKED_IN,
      };
      mockCheckInRepo.create.mockReturnValue(checkIn);
      mockCheckInRepo.save.mockResolvedValue(checkIn);

      const result = await service.checkIn(adminUser, { childId: 'child-1' });

      expect(mockCheckInRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: ChildCheckInStatusEnum.CHECKED_IN }),
      );
      expect(result.pickupCode).toBe('ABC123');
    });
  });

  // ─── verifyPickupCode ─────────────────────────────────────────────────────

  describe('verifyPickupCode', () => {
    it('should throw NotFoundException for invalid or expired code', async () => {
      mockCheckInRepo.findOne.mockResolvedValue(null);
      await expect(
        service.verifyPickupCode(adminUser, 'BADCODE'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should uppercase the code before querying', async () => {
      const checkIn = {
        id: 'ci-1',
        pickupCode: 'ABC123',
        status: ChildCheckInStatusEnum.CHECKED_IN,
        child: mockChild,
      };
      mockCheckInRepo.findOne.mockResolvedValue(checkIn);

      await service.verifyPickupCode(adminUser, 'abc123');

      expect(mockCheckInRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ pickupCode: 'ABC123' }),
        }),
      );
    });
  });

  // ─── checkOut ────────────────────────────────────────────────────────────

  describe('checkOut', () => {
    it('should throw NotFoundException for invalid or already used code', async () => {
      mockCheckInRepo.findOne.mockResolvedValue(null);
      await expect(
        service.checkOut(adminUser, { pickupCode: 'INVALID' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should update status to CHECKED_OUT and set checkout time', async () => {
      const checkIn = {
        id: 'ci-1',
        pickupCode: 'ABC123',
        status: ChildCheckInStatusEnum.CHECKED_IN,
        child: { id: 'child-1' },
        checkoutTime: null,
        pickedUpBy: null,
        pickedUpByName: null,
      };
      mockCheckInRepo.findOne.mockResolvedValue(checkIn);
      mockCheckInRepo.save.mockImplementation((e) => Promise.resolve(e));
      mockChildProfileRepo.findOne.mockResolvedValue(null);

      const result = await service.checkOut(adminUser, {
        pickupCode: 'ABC123',
        pickedUpByName: 'Dad',
      });

      expect(result.status).toBe(ChildCheckInStatusEnum.CHECKED_OUT);
      expect(result.checkoutTime).not.toBeNull();
      expect(result.pickedUpByName).toBe('Dad');
    });

    it('should send pickup email to all guardians with an email address', async () => {
      const checkIn = {
        id: 'ci-1',
        pickupCode: 'ABC123',
        status: ChildCheckInStatusEnum.CHECKED_IN,
        child: { id: 'child-1' },
        checkoutTime: null,
        pickedUpBy: null,
        pickedUpByName: 'Mum',
      };
      mockCheckInRepo.findOne.mockResolvedValue(checkIn);
      mockCheckInRepo.save.mockImplementation((e) =>
        Promise.resolve({ ...e, checkoutTime: new Date() }),
      );

      const childWithGuardians = {
        ...mockChild,
        classGroup: { name: 'Room A' },
        guardians: [
          {
            id: 'g-1',
            fullName: 'Dad',
            email: 'dad@example.com',
            member: null,
          },
          {
            id: 'g-2',
            fullName: 'Grandma',
            email: null,
            member: { email: 'grandma@church.org' },
          },
          { id: 'g-3', fullName: 'Cousin', email: null, member: null },
        ],
      };
      mockChildProfileRepo.findOne.mockResolvedValue(childWithGuardians);

      await service.checkOut(adminUser, {
        pickupCode: 'ABC123',
        pickedUpByName: 'Mum',
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockUtilityService.sendEmailWithTemplate).toHaveBeenCalledTimes(2);
      expect(mockUtilityService.sendEmailWithTemplate).toHaveBeenCalledWith(
        'dad@example.com',
        expect.stringContaining('Alice Smith'),
        'child-pickup',
        expect.objectContaining({ guardianName: 'Dad', pickedUpBy: 'Mum' }),
        undefined,
        'CHILDREN_CHURCH',
      );
      expect(mockUtilityService.sendEmailWithTemplate).toHaveBeenCalledWith(
        'grandma@church.org',
        expect.any(String),
        'child-pickup',
        expect.objectContaining({ guardianName: 'Grandma' }),
        undefined,
        'CHILDREN_CHURCH',
      );
    });

    it('should uppercase the pickup code before lookup', async () => {
      mockCheckInRepo.findOne.mockResolvedValue(null);

      await expect(
        service.checkOut(adminUser, { pickupCode: 'abc123' }),
      ).rejects.toThrow(NotFoundException);

      expect(mockCheckInRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ pickupCode: 'ABC123' }),
        }),
      );
    });
  });

  // ─── flagCheckIn ─────────────────────────────────────────────────────────

  describe('flagCheckIn', () => {
    it('should throw NotFoundException when check-in not found', async () => {
      mockCheckInRepo.findOne.mockResolvedValue(null);
      await expect(
        service.flagCheckIn(adminUser, 'bad-id', { reason: 'Suspicious' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should set status to FLAGGED and store reason', async () => {
      const checkIn = {
        id: 'ci-1',
        status: ChildCheckInStatusEnum.CHECKED_IN,
        flagReason: null,
      };
      mockCheckInRepo.findOne.mockResolvedValue(checkIn);
      mockCheckInRepo.save.mockImplementation((e) => Promise.resolve(e));

      const result = await service.flagCheckIn(adminUser, 'ci-1', {
        reason: 'Unknown person',
      });

      expect(result.status).toBe(ChildCheckInStatusEnum.FLAGGED);
      expect(result.flagReason).toBe('Unknown person');
    });
  });

  // ─── getActiveCheckIns ───────────────────────────────────────────────────

  describe('getActiveCheckIns', () => {
    it('should return all CHECKED_IN records when no classGroupId filter', async () => {
      const checkIns = [
        { id: 'ci-1', status: ChildCheckInStatusEnum.CHECKED_IN },
      ];
      mockCheckInRepo.find.mockResolvedValue(checkIns);

      const result = await service.getActiveCheckIns(adminUser);

      expect(mockCheckInRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: ChildCheckInStatusEnum.CHECKED_IN,
          }),
        }),
      );
      expect(result).toHaveLength(1);
    });

    it('should filter by classGroupId when provided', async () => {
      mockCheckInRepo.find.mockResolvedValue([]);

      await service.getActiveCheckIns(adminUser, 'cg-1');

      expect(mockCheckInRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            child: expect.objectContaining({ classGroup: { id: 'cg-1' } }),
          }),
        }),
      );
    });
  });

  // ─── searchChildren ───────────────────────────────────────────────────────

  describe('searchChildren', () => {
    it('should return paginated children', async () => {
      const qb = makeQb();
      qb.getManyAndCount.mockResolvedValue([[mockChild], 1]);
      mockChildProfileRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.searchChildren(adminUser, undefined, 1, 20);

      expect(result.data).toHaveLength(1);
      expect(result.totalCount).toBe(1);
    });

    it('should apply name filter when provided', async () => {
      const qb = makeQb();
      qb.getManyAndCount.mockResolvedValue([[], 0]);
      mockChildProfileRepo.createQueryBuilder.mockReturnValue(qb);

      await service.searchChildren(adminUser, 'Alice', 1, 20);

      expect(qb.where).toHaveBeenCalled();
    });
  });

  // ─── batchRecomputeAgeGroups ──────────────────────────────────────────────

  describe('batchRecomputeAgeGroups', () => {
    it('should return 0 when there are no children', async () => {
      mockAgeGroupRepo.find.mockResolvedValue([mockAgeGroup]);
      mockClassGroupRepo.find.mockResolvedValue([mockClassGroup]);
      mockChildProfileRepo.find.mockResolvedValue([]);

      const result = await service.batchRecomputeAgeGroups();

      expect(result).toEqual({ updated: 0 });
      expect(mockChildProfileRepo.save).not.toHaveBeenCalled();
    });

    it('should batch-save only children whose assignment changed', async () => {
      const ageGroup = {
        id: 'ag-1',
        name: 'Nursery',
        minAgeMonths: 0,
        maxAgeMonths: 23,
        displayOrder: 0,
      };
      const classGroup = { id: 'cg-1', name: 'Room A', ageGroup };
      const upToDate = {
        ...mockChild,
        dateOfBirth: '2025-05-01',
        ageGroup,
        classGroup,
      };
      const stale = {
        ...mockChild,
        id: 'child-2',
        dateOfBirth: '2025-05-01',
        ageGroup,
        classGroup: { id: 'cg-old' },
      };

      mockAgeGroupRepo.find.mockResolvedValue([ageGroup]);
      mockClassGroupRepo.find.mockResolvedValue([classGroup]);
      mockChildProfileRepo.find.mockResolvedValue([upToDate, stale]);
      mockChildProfileRepo.save.mockResolvedValue([stale]);

      const result = await service.batchRecomputeAgeGroups();

      expect(result.updated).toBeGreaterThanOrEqual(1);
      expect(mockChildProfileRepo.save).toHaveBeenCalledTimes(1);
    });
  });
});
