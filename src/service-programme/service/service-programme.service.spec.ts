import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ServiceProgrammeService } from './service-programme.service';
import { ServiceProgramme } from '../entity/service-programme.entity';
import { ServiceProgrammeSlot } from '../entity/service-programme-slot.entity';
import { ServiceProgrammeTemplate } from '../entity/service-programme-template.entity';
import { ServiceSlot } from '../../event/entity/service-slot.entity';
import { Member } from '../../member/entity/member.entity';
import { Admin } from '../../admin/entity/admin.entity';
import { ServiceProgrammeStatusEnum } from '../enum/service-programme-status.enum';
import { ServiceSlotTypeEnum } from '../enum/service-slot-type.enum';
import { UtilityService } from '../../utility/service/utility.service';
import { PdfService } from '../../utility/service/pdf.service';
import { EmailQueueService } from '../../utility/service/email-queue.service';
import { EmailCategory } from '../../utility/email-provider/email-category.enum';
import { PushNotificationService } from '../../push-notification/service/push-notification.service';

const mockProgrammeQueryBuilder = {
  leftJoinAndSelect: jest.fn().mockReturnThis(),
  loadRelationCountAndMap: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  getManyAndCount: jest.fn(),
};

const mockProgrammeRepo = {
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  find: jest.fn(),
  findAndCount: jest.fn(),
  remove: jest.fn(),
  update: jest.fn(),
  createQueryBuilder: jest.fn(() => mockProgrammeQueryBuilder),
};

const mockSlotConflictQueryBuilder = {
  innerJoinAndSelect: jest.fn().mockReturnThis(),
  leftJoinAndSelect: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  getOne: jest.fn().mockResolvedValue(undefined),
  getMany: jest.fn().mockResolvedValue([]),
};

const mockSlotRepo = {
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  remove: jest.fn(),
  createQueryBuilder: jest.fn(() => mockSlotConflictQueryBuilder),
};

const mockTemplateRepo = {
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  find: jest.fn(),
  remove: jest.fn(),
};

const mockServiceSlotRepo = {
  findOne: jest.fn(),
  find: jest.fn(),
};

const mockMemberRepo = {
  findOne: jest.fn(),
  find: jest.fn().mockResolvedValue([]),
};

const mockDataSource = {
  transaction: jest.fn(),
};

const mockPdfService = {
  generateProgrammeDraft: jest.fn().mockResolvedValue(Buffer.from('')),
};

const mockEmailQueueService = {
  queueEmailWithTemplate: jest.fn().mockResolvedValue('job-1'),
  queueEmailWithTemplateAndAttachments: jest.fn().mockResolvedValue('job-1'),
};

const mockPushNotificationService = {
  dispatchToMemberIds: jest.fn().mockResolvedValue(undefined),
};

const mockAdmin = {
  id: 'admin-1',
  member: { firstname: 'Ada' },
} as unknown as Admin;

const mockServiceSlot = { id: 'slot-1', name: 'First Service' };

const draftProgramme = {
  id: 'prog-1',
  status: ServiceProgrammeStatusEnum.DRAFT,
  saveAsTemplate: false,
  serviceSlot: mockServiceSlot,
  slots: [],
  createdByAdmin: mockAdmin,
};

const liveProgramme = {
  ...draftProgramme,
  id: 'prog-2',
  status: ServiceProgrammeStatusEnum.LIVE,
};

describe('ServiceProgrammeService', () => {
  let service: ServiceProgrammeService;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(UtilityService, 'createPaginationResponse').mockReturnValue({
      data: [],
      page: 1,
      limit: 20,
      totalCount: 0,
      totalPages: 0,
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServiceProgrammeService,
        { provide: DataSource, useValue: mockDataSource },
        {
          provide: getRepositoryToken(ServiceProgramme),
          useValue: mockProgrammeRepo,
        },
        {
          provide: getRepositoryToken(ServiceProgrammeSlot),
          useValue: mockSlotRepo,
        },
        {
          provide: getRepositoryToken(ServiceProgrammeTemplate),
          useValue: mockTemplateRepo,
        },
        {
          provide: getRepositoryToken(ServiceSlot),
          useValue: mockServiceSlotRepo,
        },
        { provide: getRepositoryToken(Member), useValue: mockMemberRepo },
        { provide: PdfService, useValue: mockPdfService },
        { provide: EmailQueueService, useValue: mockEmailQueueService },
        {
          provide: PushNotificationService,
          useValue: mockPushNotificationService,
        },
      ],
    }).compile();

    service = module.get<ServiceProgrammeService>(ServiceProgrammeService);
  });

  // ── create ───────────────────────────────────────────────────────────────

  describe('create', () => {
    it('creates a programme for a single service slot', async () => {
      mockServiceSlotRepo.find.mockResolvedValue([mockServiceSlot]);
      mockProgrammeRepo.find
        .mockResolvedValueOnce([]) // no existing conflicts
        .mockResolvedValueOnce([draftProgramme]); // batched reload
      mockProgrammeRepo.create.mockReturnValue([draftProgramme]);
      mockProgrammeRepo.save.mockResolvedValue([draftProgramme]);

      const result = await service.create(
        {
          programmes: [{ serviceSlotId: 'slot-1' }],
          saveAsTemplate: false,
        },
        mockAdmin,
      );

      expect(result).toMatchObject({ id: draftProgramme.id });
      expect(mockProgrammeRepo.save).toHaveBeenCalledWith([draftProgramme]);
    });

    it('throws NotFoundException when a service slot does not exist', async () => {
      mockServiceSlotRepo.find.mockResolvedValue([]); // requested 1, found 0
      await expect(
        service.create(
          { programmes: [{ serviceSlotId: 'slot-x' }] },
          mockAdmin,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when a programme already exists for a selected slot', async () => {
      mockServiceSlotRepo.find.mockResolvedValue([mockServiceSlot]);
      mockProgrammeRepo.find.mockResolvedValue([draftProgramme]);
      await expect(
        service.create(
          { programmes: [{ serviceSlotId: 'slot-1' }] },
          mockAdmin,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('creates the full order-of-service in one call when slots are provided', async () => {
      mockServiceSlotRepo.find.mockResolvedValue([mockServiceSlot]);
      mockProgrammeRepo.find
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([draftProgramme]);
      mockProgrammeRepo.create.mockReturnValue([draftProgramme]);
      mockProgrammeRepo.save.mockResolvedValue([draftProgramme]);
      mockSlotRepo.create.mockImplementation((d) => d);
      mockSlotRepo.save.mockImplementation((d) => Promise.resolve(d));

      await service.create(
        {
          programmes: [
            {
              serviceSlotId: 'slot-1',
              slots: [
                { type: ServiceSlotTypeEnum.WORSHIP, allocatedMinutes: 20 },
                { type: ServiceSlotTypeEnum.SPEAKER, allocatedMinutes: 40 },
              ],
            },
          ],
        },
        mockAdmin,
      );

      expect(mockSlotRepo.create).toHaveBeenCalledTimes(2);
      expect(mockSlotRepo.create).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ position: 0 }),
      );
      expect(mockSlotRepo.create).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ position: 1 }),
      );
      // Both slots are persisted in a single bulk save, not one per slot.
      expect(mockSlotRepo.save).toHaveBeenCalledTimes(1);
      expect(mockSlotRepo.save).toHaveBeenCalledWith([
        expect.objectContaining({ position: 0 }),
        expect.objectContaining({ position: 1 }),
      ]);
    });

    it('creates one programme per selected slot, each with its own independent slots, and returns an array when multiple are given', async () => {
      const secondSlot = { id: 'slot-2', name: 'Second Service' };
      const secondProgramme = {
        ...draftProgramme,
        id: 'prog-2',
        serviceSlot: secondSlot,
      };

      mockServiceSlotRepo.find.mockResolvedValue([mockServiceSlot, secondSlot]);
      mockProgrammeRepo.find
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([draftProgramme, secondProgramme]);
      mockProgrammeRepo.create.mockReturnValue([
        draftProgramme,
        secondProgramme,
      ]);
      mockProgrammeRepo.save.mockResolvedValue([
        draftProgramme,
        secondProgramme,
      ]);
      mockSlotRepo.create.mockImplementation((d) => d);
      mockSlotRepo.save.mockImplementation((d) => Promise.resolve(d));

      const result = await service.create(
        {
          programmes: [
            {
              serviceSlotId: 'slot-1',
              slots: [
                { type: ServiceSlotTypeEnum.WORSHIP, allocatedMinutes: 20 },
              ],
            },
            { serviceSlotId: 'slot-2' }, // no items — independent from slot-1
          ],
        },
        mockAdmin,
      );

      expect(Array.isArray(result)).toBe(true);
      expect((result as (typeof draftProgramme)[]).map((p) => p.id)).toEqual([
        'prog-1',
        'prog-2',
      ]);
      // Only slot-1's programme got an item created for it.
      expect(mockSlotRepo.create).toHaveBeenCalledTimes(1);
      // One bulk insert for both programmes, not one per programme.
      expect(mockProgrammeRepo.save).toHaveBeenCalledTimes(1);
    });

    it('batches member lookups for all slots across all programmes into a single query', async () => {
      mockServiceSlotRepo.find.mockResolvedValue([mockServiceSlot]);
      mockProgrammeRepo.find
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([draftProgramme]);
      mockProgrammeRepo.create.mockReturnValue([draftProgramme]);
      mockProgrammeRepo.save.mockResolvedValue([draftProgramme]);
      const memberA = { id: 'member-a', firstname: 'A', lastname: 'A' };
      const memberB = { id: 'member-b', firstname: 'B', lastname: 'B' };
      mockMemberRepo.find.mockResolvedValue([memberA, memberB]);
      mockSlotRepo.create.mockImplementation((d) => d);
      mockSlotRepo.save.mockImplementation((d) => Promise.resolve(d));

      await service.create(
        {
          programmes: [
            {
              serviceSlotId: 'slot-1',
              slots: [
                {
                  type: ServiceSlotTypeEnum.WORSHIP,
                  allocatedMinutes: 20,
                  memberId: 'member-a',
                  backupMemberId: 'member-b',
                },
              ],
            },
          ],
        },
        mockAdmin,
      );

      expect(mockMemberRepo.find).toHaveBeenCalledTimes(1);
      expect(mockSlotRepo.save).toHaveBeenCalledWith([
        expect.objectContaining({ member: memberA, backupMember: memberB }),
      ]);
    });

    it('throws NotFoundException when a slot references a member that does not exist', async () => {
      mockServiceSlotRepo.find.mockResolvedValue([mockServiceSlot]);
      mockProgrammeRepo.find.mockResolvedValueOnce([]);
      mockProgrammeRepo.create.mockReturnValue([draftProgramme]);
      mockProgrammeRepo.save.mockResolvedValue([draftProgramme]);
      mockMemberRepo.find.mockResolvedValue([]);
      mockSlotRepo.create.mockImplementation((d) => d);

      await expect(
        service.create(
          {
            programmes: [
              {
                serviceSlotId: 'slot-1',
                slots: [
                  {
                    type: ServiceSlotTypeEnum.WORSHIP,
                    allocatedMinutes: 20,
                    memberId: 'missing-member',
                  },
                ],
              },
            ],
          },
          mockAdmin,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('lists the affected slot names in the conflict message', async () => {
      mockServiceSlotRepo.find.mockResolvedValue([mockServiceSlot]);
      mockProgrammeRepo.find.mockResolvedValue([draftProgramme]);
      await expect(
        service.create(
          { programmes: [{ serviceSlotId: 'slot-1' }] },
          mockAdmin,
        ),
      ).rejects.toThrow('First Service');
    });
  });

  // ── findAll ──────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('returns paginated list', async () => {
      mockProgrammeQueryBuilder.getManyAndCount.mockResolvedValue([
        [{ ...draftProgramme, slotCount: 2 }],
        1,
      ]);
      const result = await service.findAll(1, 20);
      expect(UtilityService.createPaginationResponse).toHaveBeenCalledWith(
        [
          {
            ...draftProgramme,
            slotCount: 2,
            serviceSlotId: 'slot-1',
            serviceSlotName: 'First Service',
            event: null,
            serviceSlotDetail: {
              id: 'slot-1',
              name: 'First Service',
              startTime: undefined,
              endTime: undefined,
            },
          },
        ],
        1,
        20,
        1,
      );
      expect(result.totalCount).toBe(0);
    });

    it('throws BadRequestException for page < 1', async () => {
      await expect(service.findAll(0)).rejects.toThrow(BadRequestException);
    });
  });

  // ── findOne ──────────────────────────────────────────────────────────────

  describe('getMyUpcomingAssignments', () => {
    it('returns upcoming slots where the member is primary or backup, flagging isBackup correctly', async () => {
      const upcomingEvent = { name: 'Sunday Service' };
      const upcomingServiceSlot = {
        name: 'First Service',
        startTime: new Date('2026-08-02T09:00:00.000Z'),
        endTime: new Date('2026-08-02T11:00:00.000Z'),
        event: upcomingEvent,
      };
      mockSlotConflictQueryBuilder.getMany.mockResolvedValueOnce([
        {
          id: 'ps-1',
          type: ServiceSlotTypeEnum.SPEAKER,
          topic: 'Faith',
          allocatedMinutes: 30,
          member: { id: 'member-1' },
          programme: {
            id: 'prog-1',
            status: ServiceProgrammeStatusEnum.DRAFT,
            serviceSlot: upcomingServiceSlot,
          },
        },
        {
          id: 'ps-2',
          type: ServiceSlotTypeEnum.WORSHIP,
          topic: null,
          allocatedMinutes: 20,
          member: { id: 'someone-else' },
          programme: {
            id: 'prog-2',
            status: ServiceProgrammeStatusEnum.LIVE,
            serviceSlot: upcomingServiceSlot,
          },
        },
      ]);

      const result = await service.getMyUpcomingAssignments('member-1');
      expect(result).toHaveLength(2);
      expect(result[0].isBackup).toBe(false);
      expect(result[1].isBackup).toBe(true);
      expect(result[0].eventName).toBe('Sunday Service');
    });

    it('returns an empty list when the member has no upcoming assignments', async () => {
      mockSlotConflictQueryBuilder.getMany.mockResolvedValueOnce([]);
      const result = await service.getMyUpcomingAssignments('member-x');
      expect(result).toEqual([]);
    });

    it('includes sessionCode when the programme has gone LIVE, and null when it has not', async () => {
      const serviceSlot = {
        name: 'First Service',
        startTime: new Date('2026-08-02T09:00:00.000Z'),
        endTime: new Date('2026-08-02T11:00:00.000Z'),
        event: { name: 'Sunday Service' },
      };
      mockSlotConflictQueryBuilder.getMany.mockResolvedValueOnce([
        {
          id: 'ps-1',
          type: ServiceSlotTypeEnum.SPEAKER,
          topic: 'Faith',
          allocatedMinutes: 30,
          member: { id: 'member-1' },
          programme: {
            id: 'prog-1',
            status: ServiceProgrammeStatusEnum.LIVE,
            serviceSlot,
            session: { sessionCode: 'ABC123' },
          },
        },
        {
          id: 'ps-2',
          type: ServiceSlotTypeEnum.SPEAKER,
          topic: 'Hope',
          allocatedMinutes: 30,
          member: { id: 'member-1' },
          programme: {
            id: 'prog-2',
            status: ServiceProgrammeStatusEnum.DRAFT,
            serviceSlot,
            session: null,
          },
        },
      ]);

      const result = await service.getMyUpcomingAssignments('member-1');
      expect(result[0].sessionCode).toBe('ABC123');
      expect(result[1].sessionCode).toBeNull();
    });
  });

  describe('findOne', () => {
    it('returns programme when found', async () => {
      mockProgrammeRepo.findOne.mockResolvedValue(draftProgramme);
      const result = await service.findOne('prog-1');
      expect(result).toEqual({
        ...draftProgramme,
        serviceSlotId: 'slot-1',
        serviceSlotName: 'First Service',
        slotCount: 0,
        event: null,
        serviceSlotDetail: {
          id: 'slot-1',
          name: 'First Service',
          startTime: undefined,
          endTime: undefined,
        },
      });
    });

    it('surfaces the parent event and service slot time range for grouping', async () => {
      const timedProgramme = {
        ...draftProgramme,
        serviceSlot: {
          id: 'slot-1',
          name: 'First Service',
          startTime: new Date('2026-07-19T08:00:00.000Z'),
          endTime: new Date('2026-07-19T10:00:00.000Z'),
          event: {
            id: 'event-1',
            name: 'Sunday Gathering',
            eventDate: new Date('2026-07-19'),
          },
        },
      };
      mockProgrammeRepo.findOne.mockResolvedValue(timedProgramme);
      const result = await service.findOne('prog-1');
      expect(result.event).toEqual({
        id: 'event-1',
        name: 'Sunday Gathering',
        eventDate: new Date('2026-07-19'),
      });
      expect(result.serviceSlotDetail).toEqual({
        id: 'slot-1',
        name: 'First Service',
        startTime: new Date('2026-07-19T08:00:00.000Z'),
        endTime: new Date('2026-07-19T10:00:00.000Z'),
      });
    });

    it('flattens assigned member/backup member names onto each slot', async () => {
      const programmeWithSlots = {
        ...draftProgramme,
        slots: [
          {
            id: 'slot-a',
            member: { id: 'member-1', firstname: 'Ada', lastname: 'Obi' },
            backupMember: {
              id: 'member-2',
              firstname: 'Ben',
              lastname: 'Uche',
            },
          },
          {
            id: 'slot-b',
            member: null,
            backupMember: null,
          },
        ],
      };
      mockProgrammeRepo.findOne.mockResolvedValue(programmeWithSlots);
      const result = await service.findOne('prog-1');
      expect(result.slots[0]).toEqual(
        expect.objectContaining({
          memberName: 'Ada Obi',
          backupMemberName: 'Ben Uche',
        }),
      );
      expect(result.slots[1]).toEqual(
        expect.objectContaining({ memberName: null, backupMemberName: null }),
      );
    });

    it('throws NotFoundException when programme not found', async () => {
      mockProgrammeRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne('prog-x')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── update ───────────────────────────────────────────────────────────────

  describe('update', () => {
    it('updates saveAsTemplate flag', async () => {
      const updated = { ...draftProgramme, saveAsTemplate: true };
      mockProgrammeRepo.findOne.mockResolvedValue({ ...draftProgramme });
      mockProgrammeRepo.save.mockResolvedValue(updated);

      const result = await service.update('prog-1', { saveAsTemplate: true });
      expect(result.saveAsTemplate).toBe(true);
    });

    it('throws NotFoundException when programme not found', async () => {
      mockProgrammeRepo.findOne.mockResolvedValue(null);
      await expect(
        service.update('prog-x', { saveAsTemplate: true }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── remove ───────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('removes a DRAFT programme', async () => {
      mockProgrammeRepo.findOne.mockResolvedValue(draftProgramme);
      await service.remove('prog-1');
      expect(mockProgrammeRepo.remove).toHaveBeenCalledWith(draftProgramme);
    });

    it('throws BadRequestException when programme is not DRAFT', async () => {
      mockProgrammeRepo.findOne.mockResolvedValue(liveProgramme);
      await expect(service.remove('prog-2')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NotFoundException when programme not found', async () => {
      mockProgrammeRepo.findOne.mockResolvedValue(null);
      await expect(service.remove('prog-x')).rejects.toThrow(NotFoundException);
    });
  });

  // ── addSlot ──────────────────────────────────────────────────────────────

  describe('addSlot', () => {
    const dto = { type: ServiceSlotTypeEnum.SPEAKER, allocatedMinutes: 30 };

    it('appends slot at next position', async () => {
      const progWithSlots = {
        ...draftProgramme,
        slots: [{ position: 0 }, { position: 1 }],
      };
      mockProgrammeRepo.findOne.mockResolvedValue(progWithSlots);
      mockMemberRepo.findOne.mockResolvedValue(null);
      const created = { id: 'new-slot', position: 2, ...dto };
      mockSlotRepo.create.mockReturnValue(created);
      mockSlotRepo.save.mockResolvedValue(created);

      const result = await service.addSlot('prog-1', dto);
      expect(mockSlotRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ position: 2 }),
      );
      expect(result.position).toBe(2);
    });

    it('flattens the assigned member name onto the returned slot', async () => {
      mockProgrammeRepo.findOne.mockResolvedValue(draftProgramme);
      const assignedMember = {
        id: 'member-1',
        firstname: 'Ada',
        lastname: 'Obi',
        email: 'ada@example.com',
      };
      mockMemberRepo.findOne.mockResolvedValue(assignedMember);
      const created = {
        id: 'new-slot',
        position: 0,
        member: assignedMember,
        ...dto,
      };
      mockSlotRepo.create.mockReturnValue(created);
      mockSlotRepo.save.mockResolvedValue(created);

      const result = await service.addSlot('prog-1', {
        ...dto,
        memberId: 'member-1',
      });
      expect(result.memberName).toBe('Ada Obi');
    });

    it('sets position to 0 when programme has no slots', async () => {
      mockProgrammeRepo.findOne.mockResolvedValue(draftProgramme);
      const created = { id: 'new-slot', position: 0, ...dto };
      mockSlotRepo.create.mockReturnValue(created);
      mockSlotRepo.save.mockResolvedValue(created);

      await service.addSlot('prog-1', dto);
      expect(mockSlotRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ position: 0 }),
      );
    });

    it('throws BadRequestException when programme is not DRAFT', async () => {
      mockProgrammeRepo.findOne.mockResolvedValue(liveProgramme);
      await expect(service.addSlot('prog-2', dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NotFoundException when programme not found', async () => {
      mockProgrammeRepo.findOne.mockResolvedValue(null);
      await expect(service.addSlot('prog-x', dto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when memberId is provided but member not found', async () => {
      mockProgrammeRepo.findOne.mockResolvedValue(draftProgramme);
      mockMemberRepo.findOne.mockResolvedValue(null);
      await expect(
        service.addSlot('prog-1', { ...dto, memberId: 'member-x' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('emails the assigned member when they have an email address', async () => {
      mockProgrammeRepo.findOne.mockResolvedValue(draftProgramme);
      const assignedMember = {
        id: 'member-1',
        firstname: 'Ada',
        email: 'ada@example.com',
      };
      mockMemberRepo.findOne.mockResolvedValue(assignedMember);
      const created = { id: 'new-slot', position: 0, ...dto };
      mockSlotRepo.create.mockReturnValue(created);
      mockSlotRepo.save.mockResolvedValue(created);

      await service.addSlot('prog-1', { ...dto, memberId: 'member-1' });

      expect(mockEmailQueueService.queueEmailWithTemplate).toHaveBeenCalledWith(
        'ada@example.com',
        expect.any(String),
        'service-slot-assigned',
        expect.objectContaining({ memberName: 'Ada' }),
        undefined,
        EmailCategory.SERVICE_PROGRAMME_ASSIGNMENT,
      );
    });

    it('also emails the backup member, with the backup-specific subject and template flag', async () => {
      mockProgrammeRepo.findOne.mockResolvedValue(draftProgramme);
      const assignedMember = {
        id: 'member-1',
        firstname: 'Ada',
        email: 'ada@example.com',
      };
      const backupMember = {
        id: 'member-2',
        firstname: 'Ben',
        email: 'ben@example.com',
      };
      mockMemberRepo.findOne
        .mockResolvedValueOnce(assignedMember)
        .mockResolvedValueOnce(backupMember);
      const created = { id: 'new-slot', position: 0, ...dto };
      mockSlotRepo.create.mockReturnValue(created);
      mockSlotRepo.save.mockResolvedValue(created);

      await service.addSlot('prog-1', {
        ...dto,
        memberId: 'member-1',
        backupMemberId: 'member-2',
      });

      expect(mockEmailQueueService.queueEmailWithTemplate).toHaveBeenCalledWith(
        'ben@example.com',
        expect.stringContaining('Backup'),
        'service-slot-assigned',
        expect.objectContaining({ memberName: 'Ben', isBackup: true }),
        undefined,
        EmailCategory.SERVICE_PROGRAMME_ASSIGNMENT,
      );
      expect(mockEmailQueueService.queueEmailWithTemplate).toHaveBeenCalledWith(
        'ada@example.com',
        expect.any(String),
        'service-slot-assigned',
        expect.objectContaining({ memberName: 'Ada', isBackup: false }),
        undefined,
        EmailCategory.SERVICE_PROGRAMME_ASSIGNMENT,
      );
    });

    it('attaches an .ics calendar invite when the service slot has a start/end time', async () => {
      const timedProgramme = {
        ...draftProgramme,
        serviceSlot: {
          ...mockServiceSlot,
          startTime: new Date('2026-08-02T09:00:00.000Z'),
          endTime: new Date('2026-08-02T11:00:00.000Z'),
        },
      };
      mockProgrammeRepo.findOne.mockResolvedValue(timedProgramme);
      const assignedMember = {
        id: 'member-1',
        firstname: 'Ada',
        email: 'ada@example.com',
      };
      mockMemberRepo.findOne.mockResolvedValue(assignedMember);
      const created = { id: 'new-slot', position: 0, ...dto };
      mockSlotRepo.create.mockReturnValue(created);
      mockSlotRepo.save.mockResolvedValue(created);

      await service.addSlot('prog-1', { ...dto, memberId: 'member-1' });

      expect(
        mockEmailQueueService.queueEmailWithTemplateAndAttachments,
      ).toHaveBeenCalledWith(
        'ada@example.com',
        expect.any(String),
        'service-slot-assigned',
        expect.objectContaining({ memberName: 'Ada' }),
        [expect.objectContaining({ filename: 'service-slot.ics' })],
        undefined,
        EmailCategory.SERVICE_PROGRAMME_ASSIGNMENT,
      );
      expect(
        mockEmailQueueService.queueEmailWithTemplate,
      ).not.toHaveBeenCalled();
    });

    it('does not email when the assigned member has no email', async () => {
      mockProgrammeRepo.findOne.mockResolvedValue(draftProgramme);
      mockMemberRepo.findOne.mockResolvedValue({
        id: 'member-1',
        firstname: 'Ada',
        email: null,
      });
      const created = { id: 'new-slot', position: 0, ...dto };
      mockSlotRepo.create.mockReturnValue(created);
      mockSlotRepo.save.mockResolvedValue(created);

      await service.addSlot('prog-1', { ...dto, memberId: 'member-1' });
      expect(
        mockEmailQueueService.queueEmailWithTemplate,
      ).not.toHaveBeenCalled();
    });

    it('dispatches a push notification to the assigned member even when they have no email', async () => {
      mockProgrammeRepo.findOne.mockResolvedValue(draftProgramme);
      mockMemberRepo.findOne.mockResolvedValue({
        id: 'member-1',
        firstname: 'Ada',
        email: null,
      });
      const created = { id: 'new-slot', position: 0, ...dto };
      mockSlotRepo.create.mockReturnValue(created);
      mockSlotRepo.save.mockResolvedValue(created);

      await service.addSlot('prog-1', { ...dto, memberId: 'member-1' });

      expect(
        mockPushNotificationService.dispatchToMemberIds,
      ).toHaveBeenCalledWith(
        ['member-1'],
        expect.objectContaining({
          idempotencyKey: 'service-slot-assigned:new-slot:member-1',
        }),
      );
    });

    it('includes the formatted service date and time in both the email data and the push body', async () => {
      const timedProgramme = {
        ...draftProgramme,
        serviceSlot: {
          ...mockServiceSlot,
          startTime: new Date('2026-08-02T09:00:00.000Z'),
          endTime: new Date('2026-08-02T11:00:00.000Z'),
        },
      };
      mockProgrammeRepo.findOne.mockResolvedValue(timedProgramme);
      const assignedMember = {
        id: 'member-1',
        firstname: 'Ada',
        email: 'ada@example.com',
      };
      mockMemberRepo.findOne.mockResolvedValue(assignedMember);
      const created = { id: 'new-slot', position: 0, ...dto };
      mockSlotRepo.create.mockReturnValue(created);
      mockSlotRepo.save.mockResolvedValue(created);

      await service.addSlot('prog-1', { ...dto, memberId: 'member-1' });

      expect(
        mockEmailQueueService.queueEmailWithTemplateAndAttachments,
      ).toHaveBeenCalledWith(
        'ada@example.com',
        expect.any(String),
        'service-slot-assigned',
        expect.objectContaining({
          serviceDate: expect.stringContaining('2026'),
          serviceTime: expect.stringContaining('–'),
        }),
        expect.any(Array),
        undefined,
        EmailCategory.SERVICE_PROGRAMME_ASSIGNMENT,
      );
      expect(
        mockPushNotificationService.dispatchToMemberIds,
      ).toHaveBeenCalledWith(
        ['member-1'],
        expect.objectContaining({
          body: expect.stringContaining('2026'),
        }),
      );
    });

    it('returns a conflictWarning when the member has an overlapping slot elsewhere', async () => {
      mockProgrammeRepo.findOne.mockResolvedValue(draftProgramme);
      const assignedMember = {
        id: 'member-1',
        firstname: 'Ada',
        lastname: 'Lovelace',
        email: 'ada@example.com',
      };
      mockMemberRepo.findOne.mockResolvedValue(assignedMember);
      const created = { id: 'new-slot', position: 0, ...dto };
      mockSlotRepo.create.mockReturnValue(created);
      mockSlotRepo.save.mockResolvedValue(created);
      mockSlotConflictQueryBuilder.getOne.mockResolvedValueOnce({
        id: 'other-slot',
        programme: {
          serviceSlot: { name: 'Second Service', event: { name: 'Sunday' } },
        },
      });

      const result = await service.addSlot('prog-1', {
        ...dto,
        memberId: 'member-1',
      });
      expect(result.conflictWarning).toContain('Ada Lovelace');
      expect(result.conflictWarning).toContain('Sunday');
    });

    it('does not set conflictWarning when there is no overlapping slot', async () => {
      mockProgrammeRepo.findOne.mockResolvedValue(draftProgramme);
      const assignedMember = {
        id: 'member-1',
        firstname: 'Ada',
        email: 'ada@example.com',
      };
      mockMemberRepo.findOne.mockResolvedValue(assignedMember);
      const created = { id: 'new-slot', position: 0, ...dto };
      mockSlotRepo.create.mockReturnValue(created);
      mockSlotRepo.save.mockResolvedValue(created);

      const result = await service.addSlot('prog-1', {
        ...dto,
        memberId: 'member-1',
      });
      expect(result.conflictWarning).toBeUndefined();
    });
  });

  // ── updateSlot ───────────────────────────────────────────────────────────

  describe('updateSlot', () => {
    const baseSlot = {
      id: 'slot-1',
      type: ServiceSlotTypeEnum.SPEAKER,
      topic: 'Opening',
      allocatedMinutes: 15,
      member: null,
      backupMember: null,
      programme: draftProgramme,
    };

    it('emails the newly assigned member', async () => {
      mockSlotRepo.findOne.mockResolvedValue({ ...baseSlot });
      const assignedMember = {
        id: 'member-1',
        firstname: 'Ada',
        email: 'ada@example.com',
      };
      mockMemberRepo.findOne.mockResolvedValue(assignedMember);
      mockSlotRepo.save.mockImplementation((s) => Promise.resolve(s));

      await service.updateSlot('prog-1', 'slot-1', { memberId: 'member-1' });

      expect(mockEmailQueueService.queueEmailWithTemplate).toHaveBeenCalledWith(
        'ada@example.com',
        expect.any(String),
        'service-slot-assigned',
        expect.objectContaining({ memberName: 'Ada' }),
        undefined,
        EmailCategory.SERVICE_PROGRAMME_ASSIGNMENT,
      );
    });

    it('emails the newly assigned backup member', async () => {
      mockSlotRepo.findOne.mockResolvedValue({ ...baseSlot });
      const backupMember = {
        id: 'member-2',
        firstname: 'Ben',
        email: 'ben@example.com',
      };
      mockMemberRepo.findOne.mockResolvedValue(backupMember);
      mockSlotRepo.save.mockImplementation((s) => Promise.resolve(s));

      await service.updateSlot('prog-1', 'slot-1', {
        backupMemberId: 'member-2',
      });

      expect(mockEmailQueueService.queueEmailWithTemplate).toHaveBeenCalledWith(
        'ben@example.com',
        expect.stringContaining('Backup'),
        'service-slot-assigned',
        expect.objectContaining({ memberName: 'Ben', isBackup: true }),
        undefined,
        EmailCategory.SERVICE_PROGRAMME_ASSIGNMENT,
      );
    });

    it('does not re-email the backup when the backup member is unchanged', async () => {
      const existingBackup = {
        id: 'member-2',
        firstname: 'Ben',
        email: 'ben@example.com',
      };
      mockSlotRepo.findOne.mockResolvedValue({
        ...baseSlot,
        backupMember: existingBackup,
      });
      mockMemberRepo.findOne.mockResolvedValue(existingBackup);
      mockSlotRepo.save.mockImplementation((s) => Promise.resolve(s));

      await service.updateSlot('prog-1', 'slot-1', {
        backupMemberId: 'member-2',
        topic: 'Updated',
      });

      expect(
        mockEmailQueueService.queueEmailWithTemplate,
      ).not.toHaveBeenCalled();
    });

    it('does not re-email when the member is unchanged', async () => {
      const existingMember = {
        id: 'member-1',
        firstname: 'Ada',
        email: 'ada@example.com',
      };
      mockSlotRepo.findOne.mockResolvedValue({
        ...baseSlot,
        member: existingMember,
      });
      mockSlotRepo.save.mockImplementation((s) => Promise.resolve(s));

      await service.updateSlot('prog-1', 'slot-1', { topic: 'Updated Topic' });
      expect(
        mockEmailQueueService.queueEmailWithTemplate,
      ).not.toHaveBeenCalled();
    });

    it('does not email when the slot is cleared to no member', async () => {
      const existingMember = {
        id: 'member-1',
        firstname: 'Ada',
        email: 'ada@example.com',
      };
      mockSlotRepo.findOne.mockResolvedValue({
        ...baseSlot,
        member: existingMember,
      });
      mockSlotRepo.save.mockImplementation((s) => Promise.resolve(s));

      await service.updateSlot('prog-1', 'slot-1', { memberId: null });
      expect(
        mockEmailQueueService.queueEmailWithTemplate,
      ).not.toHaveBeenCalled();
    });

    it('returns a conflictWarning when the newly assigned member overlaps another slot', async () => {
      mockSlotRepo.findOne.mockResolvedValue({ ...baseSlot });
      const assignedMember = {
        id: 'member-1',
        firstname: 'Ada',
        lastname: 'Lovelace',
        email: 'ada@example.com',
      };
      mockMemberRepo.findOne.mockResolvedValue(assignedMember);
      mockSlotRepo.save.mockImplementation((s) => Promise.resolve(s));
      mockSlotConflictQueryBuilder.getOne.mockResolvedValueOnce({
        id: 'other-slot',
        programme: { serviceSlot: { name: 'Second Service', event: null } },
      });

      const result = await service.updateSlot('prog-1', 'slot-1', {
        memberId: 'member-1',
      });
      expect(result.conflictWarning).toContain('Ada Lovelace');
    });

    it('does not check for conflicts when the member is unchanged', async () => {
      const existingMember = {
        id: 'member-1',
        firstname: 'Ada',
        email: 'ada@example.com',
      };
      mockSlotRepo.findOne.mockResolvedValue({
        ...baseSlot,
        member: existingMember,
      });
      mockSlotRepo.save.mockImplementation((s) => Promise.resolve(s));

      const result = await service.updateSlot('prog-1', 'slot-1', {
        topic: 'Updated Topic',
      });
      expect(mockSlotRepo.createQueryBuilder).not.toHaveBeenCalled();
      expect(result.conflictWarning).toBeUndefined();
    });

    it('throws BadRequestException when programme is not DRAFT', async () => {
      mockSlotRepo.findOne.mockResolvedValue({
        ...baseSlot,
        programme: liveProgramme,
      });
      await expect(
        service.updateSlot('prog-2', 'slot-1', { topic: 'x' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when slot not found', async () => {
      mockSlotRepo.findOne.mockResolvedValue(null);
      await expect(
        service.updateSlot('prog-1', 'slot-x', { topic: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── reorderSlots ─────────────────────────────────────────────────────────

  describe('reorderSlots', () => {
    const slotA = { id: 'sa', position: 0 };
    const slotB = { id: 'sb', position: 1 };

    it('reorders slots and saves updated positions', async () => {
      mockProgrammeRepo.findOne.mockResolvedValue({
        ...draftProgramme,
        slots: [slotA, slotB],
      });
      mockSlotRepo.save.mockResolvedValue([
        { ...slotB, position: 0 },
        { ...slotA, position: 1 },
      ]);

      await service.reorderSlots('prog-1', {
        slots: [{ id: 'sb' }, { id: 'sa' }],
      });
      expect(mockSlotRepo.save).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ id: 'sb', position: 0 }),
          expect.objectContaining({ id: 'sa', position: 1 }),
        ]),
      );
    });

    it('throws BadRequestException when slot IDs do not match programme slots', async () => {
      mockProgrammeRepo.findOne.mockResolvedValue({
        ...draftProgramme,
        slots: [slotA, slotB],
      });
      await expect(
        service.reorderSlots('prog-1', {
          slots: [{ id: 'sa' }, { id: 'unknown' }],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── removeSlot ───────────────────────────────────────────────────────────

  describe('removeSlot', () => {
    it('removes a slot from a DRAFT programme', async () => {
      const slot = { id: 'slot-a', programme: draftProgramme };
      mockSlotRepo.findOne.mockResolvedValue(slot);
      await service.removeSlot('prog-1', 'slot-a');
      expect(mockSlotRepo.remove).toHaveBeenCalledWith(slot);
    });

    it('throws BadRequestException when programme is LIVE', async () => {
      mockSlotRepo.findOne.mockResolvedValue({
        id: 'slot-a',
        programme: liveProgramme,
      });
      await expect(service.removeSlot('prog-2', 'slot-a')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NotFoundException when slot not found', async () => {
      mockSlotRepo.findOne.mockResolvedValue(null);
      await expect(service.removeSlot('prog-1', 'slot-x')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── upsertTemplateFromProgramme ───────────────────────────────────────────

  describe('upsertTemplateFromProgramme', () => {
    const progWithSlots = {
      ...draftProgramme,
      serviceSlot: { name: 'First Service' },
      slots: [
        {
          position: 0,
          type: ServiceSlotTypeEnum.SPEAKER,
          topic: 'Opening',
          allocatedMinutes: 10,
        },
        {
          position: 1,
          type: ServiceSlotTypeEnum.BREAK,
          topic: null,
          allocatedMinutes: 5,
        },
      ],
    } as any;

    it('creates a new template when none exists for the slot name', async () => {
      mockTemplateRepo.findOne.mockResolvedValue(null);
      const created = { id: 'tpl-1' };
      mockTemplateRepo.create.mockReturnValue(created);
      mockTemplateRepo.save.mockResolvedValue(created);

      await service.upsertTemplateFromProgramme(progWithSlots);
      expect(mockTemplateRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'First Service',
          serviceSlotName: 'First Service',
        }),
      );
      expect(mockTemplateRepo.save).toHaveBeenCalledWith(created);
    });

    it('updates existing template when one exists for the slot name', async () => {
      const existingTemplate = { id: 'tpl-1', slots: [], createdFrom: null };
      mockTemplateRepo.findOne.mockResolvedValue(existingTemplate);
      mockTemplateRepo.save.mockResolvedValue({
        ...existingTemplate,
        slots: progWithSlots.slots,
      });

      await service.upsertTemplateFromProgramme(progWithSlots);
      expect(mockTemplateRepo.create).not.toHaveBeenCalled();
      expect(mockTemplateRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'tpl-1', createdFrom: progWithSlots }),
      );
    });
  });

  // ── findAllTemplates / removeTemplate ─────────────────────────────────────

  describe('findAllTemplates', () => {
    it('returns all templates ordered by name', async () => {
      const templates = [{ id: 'tpl-1', name: 'First Service' }];
      mockTemplateRepo.find.mockResolvedValue(templates);
      const result = await service.findAllTemplates();
      expect(result).toEqual(templates);
    });
  });

  describe('removeTemplate', () => {
    it('removes template when found', async () => {
      const template = { id: 'tpl-1', name: 'First Service' };
      mockTemplateRepo.findOne.mockResolvedValue(template);
      await service.removeTemplate('tpl-1');
      expect(mockTemplateRepo.remove).toHaveBeenCalledWith(template);
    });

    it('throws NotFoundException when template not found', async () => {
      mockTemplateRepo.findOne.mockResolvedValue(null);
      await expect(service.removeTemplate('tpl-x')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── findStartableDraftProgrammesForEvent ──────────────────────────────────

  describe('findStartableDraftProgrammesForEvent', () => {
    it('returns only DRAFT programmes that have at least one slot', async () => {
      mockServiceSlotRepo.find.mockResolvedValue([
        mockServiceSlot,
        { id: 'slot-2', name: 'Second Service' },
      ]);
      mockProgrammeRepo.find.mockResolvedValue([
        { ...draftProgramme, id: 'prog-1', slots: [{ id: 'ps-1' }] },
        { ...draftProgramme, id: 'prog-2', slots: [] },
        { ...liveProgramme, id: 'prog-3', slots: [{ id: 'ps-3' }] },
      ]);

      const result =
        await service.findStartableDraftProgrammesForEvent('event-1');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('prog-1');
    });

    it('throws NotFoundException when the event has no service slots', async () => {
      mockServiceSlotRepo.find.mockResolvedValue([]);
      await expect(
        service.findStartableDraftProgrammesForEvent('event-x'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
