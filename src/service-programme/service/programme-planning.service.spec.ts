// ServiceProgrammeService pulls in jsdom through SanitizationService.
jest.mock('../../utility/service/sanitization.service', () => ({
  SanitizationService: jest.fn(),
}));

import { BadRequestException } from '@nestjs/common';
import { ProgrammePlanningService } from './programme-planning.service';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { DepartmentCapability } from '../../department/enums/department-capability.enum';
import { MeetingFormatEnum } from '../../utility/enum/meeting-format.enum';
import { ServiceSlotTypeEnum } from '../enum/service-slot-type.enum';

describe('ProgrammePlanningService', () => {
  const slotRepo = { find: jest.fn() };
  const programmeRepo = { find: jest.fn(), findOne: jest.fn() };
  const qb = {
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    getMany: jest
      .fn()
      .mockResolvedValue([
        { id: 'm1', firstname: 'Ada', lastname: 'Obi', photoUrl: null },
      ]),
  };
  const memberRepo = { createQueryBuilder: jest.fn(() => qb) };
  const departmentRepo = {
    find: jest.fn().mockResolvedValue([
      { id: 'd1', name: 'Choir' },
      { id: 'd2', name: 'Ushering' },
    ]),
  };
  const adminRepo = { findOne: jest.fn() };
  const auditLog = { log: jest.fn() };
  const access = { hasCapability: jest.fn() };
  const now = new Date('2026-10-18T08:00:00Z');
  const dates = {
    now: () => now,
    addDays: (d: Date, n: number) => new Date(d.getTime() + n * 864e5),
  };
  const programmes = {
    create: jest.fn(),
    applyTemplate: jest.fn(),
    findOne: jest.fn((id: string): Promise<unknown> =>
      Promise.resolve({ id, status: 'DRAFT', slots: [] }),
    ),
  };
  const service = new ProgrammePlanningService(
    slotRepo as never,
    programmeRepo as never,
    memberRepo as never,
    departmentRepo as never,
    adminRepo as never,
    access as never,
    dates as never,
    programmes as never,
    auditLog as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    adminRepo.findOne.mockResolvedValue(null);
    access.hasCapability.mockResolvedValue(false);
  });

  describe('canPlan', () => {
    it('lets an admin with programme edit access plan', async () => {
      adminRepo.findOne.mockResolvedValue({
        adminRole: { permissions: [AdminPermission.SERVICE_PROGRAMME_WRITE] },
      });
      await expect(service.canPlan('m1')).resolves.toBe(true);
      expect(access.hasCapability).not.toHaveBeenCalled();
    });

    it('lets a worker in a Service Programme Planning department plan', async () => {
      adminRepo.findOne.mockResolvedValue({ adminRole: { permissions: [] } });
      access.hasCapability.mockResolvedValue(true);
      await expect(service.canPlan('m1')).resolves.toBe(true);
      expect(access.hasCapability).toHaveBeenCalledWith(
        'm1',
        DepartmentCapability.PLAN_SERVICE_PROGRAMME,
      );
    });

    it('refuses everyone else', async () => {
      await expect(service.canPlan('m1')).resolves.toBe(false);
    });
  });

  describe('upcoming', () => {
    const slot = (id: string, eventId: string, extra = {}) => ({
      id,
      name: `Service ${id}`,
      startTime: new Date('2026-10-18T09:00:00Z'),
      endTime: new Date('2026-10-18T11:00:00Z'),
      event: { id: eventId, name: `Event ${eventId}`, eventDate: '2026-10-18' },
      venueOverride: null,
      formatOverride: null,
      config: {
        defaultFormat: MeetingFormatEnum.IN_PERSON,
        defaultVenue: { name: 'Main Hall' },
      },
      ...extra,
    });

    it('groups services by event with each programme’s items and minutes', async () => {
      slotRepo.find.mockResolvedValue([
        slot('s1', 'e1'),
        slot('s2', 'e1', { formatOverride: MeetingFormatEnum.ONLINE }),
        slot('s3', 'e2', { venueOverride: { name: 'Ikeja Campus' } }),
      ]);
      programmeRepo.find.mockResolvedValue([
        {
          id: 'p1',
          status: 'DRAFT',
          serviceSlot: { id: 's1' },
          slots: [{ allocatedMinutes: 30 }, { allocatedMinutes: 45 }],
        },
      ]);
      const events = await service.upcoming();
      expect(events).toHaveLength(2);
      expect(events[0].services).toEqual([
        expect.objectContaining({
          serviceSlotId: 's1',
          place: 'Main Hall',
          programme: {
            id: 'p1',
            status: 'DRAFT',
            itemCount: 2,
            totalMinutes: 75,
          },
        }),
        expect.objectContaining({
          serviceSlotId: 's2',
          place: 'Online',
          programme: null,
        }),
      ]);
      expect(events[1].services[0].place).toBe('Ikeja Campus');
    });

    it('returns nothing without querying programmes when no services are coming up', async () => {
      slotRepo.find.mockResolvedValue([]);
      await expect(service.upcoming()).resolves.toEqual([]);
      expect(programmeRepo.find).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    beforeEach(() => programmes.create.mockResolvedValue({ id: 'new' }));

    it('creates an empty draft and returns it', async () => {
      await expect(
        service.create('m1', { serviceSlotId: 's1' }),
      ).resolves.toEqual(
        expect.objectContaining({ id: 'new', items: [], totalMinutes: 0 }),
      );
      expect(programmes.create).toHaveBeenCalledWith(
        { programmes: [{ serviceSlotId: 's1', slots: [] }] },
        null,
      );
      expect(programmes.applyTemplate).not.toHaveBeenCalled();
    });

    it('fills it from a template', async () => {
      await service.create('m1', { serviceSlotId: 's1', templateId: 't1' });
      expect(programmes.applyTemplate).toHaveBeenCalledWith('new', 't1');
    });

    it('copies another programme’s order, people and minutes', async () => {
      programmeRepo.findOne.mockResolvedValue({
        slots: [
          {
            type: ServiceSlotTypeEnum.WORSHIP,
            topic: 'Praise & Worship',
            member: null,
            guestName: null,
            department: { id: 'd1' },
            backupMember: { id: 'm9' },
            backupGuestName: null,
            backupDepartment: null,
            allocatedMinutes: 30,
          },
        ],
      });
      await service.create('m1', {
        serviceSlotId: 's2',
        copyFromProgrammeId: 'p1',
      });
      expect(programmes.create).toHaveBeenCalledWith(
        {
          programmes: [
            {
              serviceSlotId: 's2',
              slots: [
                expect.objectContaining({
                  type: ServiceSlotTypeEnum.WORSHIP,
                  topic: 'Praise & Worship',
                  departmentId: 'd1',
                  backupMemberId: 'm9',
                  allocatedMinutes: 30,
                }),
              ],
            },
          ],
        },
        null,
      );
    });

    it('records the admin when the planner is one', async () => {
      const admin = {
        adminRole: { permissions: [AdminPermission.SERVICE_PROGRAMME_WRITE] },
      };
      adminRepo.findOne.mockResolvedValue(admin);
      await service.create('m1', { serviceSlotId: 's1' });
      expect(programmes.create).toHaveBeenCalledWith(expect.anything(), admin);
    });

    it('refuses a template and a copy at once', async () => {
      await expect(
        service.create('m1', {
          serviceSlotId: 's1',
          templateId: 't1',
          copyFromProgrammeId: 'p1',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(programmes.create).not.toHaveBeenCalled();
    });
  });

  describe('people', () => {
    it('lists departments but searches members only from two letters', async () => {
      const result = await service.people('c');
      expect(result).toEqual({
        members: [],
        departments: [{ id: 'd1', name: 'Choir' }],
      });
      expect(memberRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('matches each word against first or last name', async () => {
      const result = await service.people('ada obi');
      expect(qb.andWhere).toHaveBeenCalledTimes(2);
      expect(result.members).toEqual([
        { id: 'm1', name: 'Ada Obi', photoUrl: null },
      ]);
    });
  });

  describe('view', () => {
    it('gives each item’s leader and backup by name only', async () => {
      programmes.findOne.mockResolvedValueOnce({
        id: 'p1',
        status: 'DRAFT',
        event: { id: 'e1', name: 'Sunday Service', eventDate: '2026-10-18' },
        serviceSlotDetail: {
          id: 's1',
          name: 'First Service',
          startTime: now,
          endTime: now,
        },
        slots: [
          {
            id: 'i1',
            position: 0,
            type: 'WORSHIP',
            topic: 'Praise',
            allocatedMinutes: 30,
            member: null,
            guestName: null,
            department: { id: 'd1', name: 'Choir' },
            backupMember: {
              id: 'm2',
              firstname: 'Ada',
              lastname: 'Obi',
              email: 'secret@x.org',
              phone: '080',
            },
            backupGuestName: null,
            backupDepartment: null,
          },
          {
            id: 'i2',
            position: 1,
            type: 'SPEAKER',
            topic: 'Sermon',
            allocatedMinutes: 45,
            member: null,
            guestName: 'Rev. Guest',
            department: null,
            backupMember: null,
            backupGuestName: null,
            backupDepartment: null,
          },
        ],
      });
      const view = await service.view('p1', 'Ada is also leading another item');
      expect(view.items[0].leader).toEqual({
        kind: 'department',
        id: 'd1',
        name: 'Choir',
      });
      expect(view.items[0].backup).toEqual({
        kind: 'member',
        id: 'm2',
        name: 'Ada Obi',
      });
      expect(view.items[1].leader).toEqual({
        kind: 'guest',
        id: null,
        name: 'Rev. Guest',
      });
      expect(JSON.stringify(view)).not.toContain('secret@x.org');
      expect(view.totalMinutes).toBe(75);
      expect(view.warning).toBe('Ada is also leading another item');
    });
  });

  describe('audit', () => {
    it('logs a planner change against the service, marked as from the member app', () => {
      service.audit(
        'PROGRAMME_ITEM_ADDED',
        'm1',
        ProgrammePlanningService.nameOf({
          id: 'p1',
          event: { id: 'e1', name: 'Sunday Service', eventDate: now },
          service: {
            id: 's1',
            name: 'First Service',
            startTime: now,
            endTime: now,
          },
        }),
        { topic: 'Sermon' },
      );
      expect(auditLog.log).toHaveBeenCalledWith('PROGRAMME_ITEM_ADDED', {
        actorId: 'm1',
        targetId: 'p1',
        targetName: 'Sunday Service — First Service',
        metadata: { via: 'member_app', topic: 'Sermon' },
      });
    });
  });
});
