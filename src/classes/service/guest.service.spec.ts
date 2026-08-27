import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { GuestService } from './guest.service';
import { Guest } from '../entity/guest.entity';
import { ClassEnrollment } from '../entity/class-enrollment.entity';
import { MemberService } from '../../member/service/member.service';
import { AuditLogService } from '../../utility/service/audit-log.service';

const makeQb = () => ({
  orderBy: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  getManyAndCount: jest.fn(),
  update: jest.fn().mockReturnThis(),
  set: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  execute: jest.fn().mockResolvedValue(undefined),
});

const mockGuestRepo = {
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  createQueryBuilder: jest.fn(),
};

const mockEnrollmentRepo = {
  find: jest.fn(),
  createQueryBuilder: jest.fn(),
};

const mockMemberService = {
  createByAdmin: jest.fn(),
};

const mockAuditLogService = { log: jest.fn() };

describe('GuestService', () => {
  let service: GuestService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GuestService,
        { provide: getRepositoryToken(Guest), useValue: mockGuestRepo },
        {
          provide: getRepositoryToken(ClassEnrollment),
          useValue: mockEnrollmentRepo,
        },
        { provide: MemberService, useValue: mockMemberService },
        { provide: AuditLogService, useValue: mockAuditLogService },
      ],
    }).compile();

    service = module.get<GuestService>(GuestService);
  });

  describe('findOrCreateByEmail', () => {
    it('returns the existing guest when the email already has a record', async () => {
      const existing = { id: 'guest-1', email: 'a@b.com' };
      mockGuestRepo.findOne.mockResolvedValue(existing);

      const result = await service.findOrCreateByEmail({
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'a@b.com',
      });

      expect(result).toBe(existing);
      expect(mockGuestRepo.create).not.toHaveBeenCalled();
    });

    it('creates a new guest with nullable optional fields when no record exists', async () => {
      mockGuestRepo.findOne.mockResolvedValue(null);
      const created = { firstName: 'Jane', lastName: 'Doe', email: 'a@b.com' };
      mockGuestRepo.create.mockReturnValue(created);
      mockGuestRepo.save.mockResolvedValue({ id: 'guest-1', ...created });

      const result = await service.findOrCreateByEmail({
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'a@b.com',
      });

      expect(mockGuestRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          firstName: 'Jane',
          lastName: 'Doe',
          email: 'a@b.com',
          phone: null,
          churchName: null,
          address: null,
          notes: null,
        }),
      );
      expect(result).toMatchObject({ id: 'guest-1' });
    });
  });

  describe('getById', () => {
    it('throws NotFoundException when the guest does not exist', async () => {
      mockGuestRepo.findOne.mockResolvedValue(null);

      await expect(service.getById('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns the guest when found', async () => {
      const guest = { id: 'guest-1' };
      mockGuestRepo.findOne.mockResolvedValue(guest);

      const result = await service.getById('guest-1');

      expect(result).toBe(guest);
    });
  });

  describe('getEnrollments', () => {
    it('throws NotFoundException when the guest does not exist', async () => {
      mockGuestRepo.findOne.mockResolvedValue(null);

      await expect(service.getEnrollments('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns every enrollment for the guest across all classes', async () => {
      mockGuestRepo.findOne.mockResolvedValue({ id: 'guest-1' });
      const enrollments = [{ id: 'enroll-1' }, { id: 'enroll-2' }];
      mockEnrollmentRepo.find.mockResolvedValue(enrollments);

      const result = await service.getEnrollments('guest-1');

      expect(mockEnrollmentRepo.find).toHaveBeenCalledWith({
        where: { guest: { id: 'guest-1' } },
        relations: ['churchClass'],
        order: { enrolledAt: 'DESC' },
      });
      expect(result).toEqual(enrollments);
    });
  });

  describe('convertToMember', () => {
    it('creates a member via createByAdmin, links the guest, and bulk-updates every enrollment', async () => {
      const guest = {
        id: 'guest-1',
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'a@b.com',
        phone: '+1234567890',
        convertedMember: null,
      };
      mockGuestRepo.findOne.mockResolvedValue(guest);
      const member = {
        id: 'member-1',
        email: 'a@b.com',
        firstname: 'Jane',
        lastname: 'Doe',
      };
      mockMemberService.createByAdmin.mockResolvedValue(member);
      mockGuestRepo.save.mockImplementation((g) => Promise.resolve(g));
      const qb = makeQb();
      mockEnrollmentRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.convertToMember('guest-1', 'admin-1');

      expect(mockMemberService.createByAdmin).toHaveBeenCalledWith(
        expect.objectContaining({
          firstname: 'Jane',
          lastname: 'Doe',
          email: 'a@b.com',
          phoneNumber: '+1234567890',
        }),
        'admin-1',
      );
      expect(result.convertedMember).toBe(member);
      expect(qb.update).toHaveBeenCalledWith(ClassEnrollment);
      expect(qb.set).toHaveBeenCalledWith({ member: { id: 'member-1' } });
      expect(qb.where).toHaveBeenCalledWith('guest_id = :guestId', {
        guestId: 'guest-1',
      });
      expect(qb.execute).toHaveBeenCalled();
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'GUEST_CONVERTED_TO_MEMBER',
        expect.objectContaining({
          actorId: 'admin-1',
          targetId: 'member-1',
          metadata: { guestId: 'guest-1' },
        }),
      );
    });

    it('passes undefined phoneNumber when the guest has no phone on file', async () => {
      const guest = {
        id: 'guest-1',
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'a@b.com',
        phone: null,
      };
      mockGuestRepo.findOne.mockResolvedValue(guest);
      mockMemberService.createByAdmin.mockResolvedValue({
        id: 'member-1',
        email: 'a@b.com',
        firstname: 'Jane',
        lastname: 'Doe',
      });
      mockGuestRepo.save.mockImplementation((g) => Promise.resolve(g));
      mockEnrollmentRepo.createQueryBuilder.mockReturnValue(makeQb());

      await service.convertToMember('guest-1', 'admin-1');

      expect(mockMemberService.createByAdmin).toHaveBeenCalledWith(
        expect.objectContaining({ phoneNumber: undefined }),
        'admin-1',
      );
    });
  });
});
